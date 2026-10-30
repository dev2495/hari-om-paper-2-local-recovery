"""Stock fixes after the 28 Oct checks (live PostgreSQL).

Covers: the month-end count only for a month that can still change (never before a closed month, never
before the stock book starts, the running month only in its last days) and a variance never dated before
its lot existed; one open count per rack; a lot that arrives during a count is never "not found"; counts
and corrections that touch the same lot post one difference once; loose stock lines; moves change only the
place (except production's FG hold release); material never sits where no count looks; and a stock book
check that can fail (negative closing, a lot below zero, a ledger row the book leaves out).
"""
import os
import sys
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

sys.path.insert(0, os.path.dirname(__file__))
from test_stock_count_flow_postgres import (  # noqa: E402
    OPERATOR, OWNER, PLANT_HEAD, STORE, _item, _lot, _rack, _reel, _refused, _row, setup_module,  # noqa: F401
)

from src.database import SessionLocal  # noqa: E402
from src.models import ItemMaster, PaperReel, StockAdjustmentVoucher, StockBatch, StockCountEntry, StockTransaction  # noqa: E402
from src.routers import stock_count  # noqa: E402
from src.routers.books import BooksLockPayload, lock_books_month  # noqa: E402
from src.routers.locations import LocationCreate, LocationUpdate, create_location, lots_for_labels, update_location  # noqa: E402
from src.routers.stock_control import CorrectionDecisionPayload, CorrectionPayload, approve_correction, correction_lookup, list_corrections, raise_correction  # noqa: E402
from src.routers.stock_count import (  # noqa: E402
    CountCreate, EntryUpdate, LoosePayload, NotePayload, ScanPayload, add_loose_stock, approve_count, finish_rack, get_count, list_counts,
    scan_in_count, start_count, start_rack, submit_count, update_entry,
)
from src.routers.stock_moves import ScanMovePayload, StockMoveCreate, apply_move, create_stock_move, scan_move  # noqa: E402
from src.services.stock_control import book_period  # noqa: E402
from src.services.stock_lots import batch_balances  # noqa: E402

QC = {"sub": "qc@example.com", "roles": ["QC"], "actual_roles": ["QC"], "role": "QC", "token": ""}
GRN = {"sub": "grn@example.com", "roles": ["GRN"], "actual_roles": ["GRN"], "role": "GRN", "token": ""}


def _count_rack(db, plant, cid, rack, who=STORE):
    return finish_rack(cid, str(rack.id) if not isinstance(rack, str) else rack, db, plant, who)


def _approve(db, plant, cid):
    submit_count(NotePayload(), cid, db, plant, STORE)
    return approve_count(NotePayload(), cid, db, plant, OWNER)


def test_month_end_count_only_for_a_month_that_can_still_change(monkeypatch):
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        rack = _rack(db, plant, "ME-A-01")
        _reel(db, plant, paper, 500, at=rack, inward=date(2026, 8, 5))
        db.commit()
        monkeypatch.setattr(stock_count, "ist_today", lambda: date(2026, 10, 10))
        # Before the stock book starts there is nothing to count.
        _refused(lambda: start_count(CountCreate(kind="MONTH_END", month="2026-07"), db, plant, STORE), 409, "The stock book starts in August 2026")
        # The running month opens only in its last days (a count weeks early would become its certificate).
        _refused(lambda: start_count(CountCreate(kind="MONTH_END", month="2026-10"), db, plant, STORE), 409, "opens on 29 Oct 2026")
        listing = list_counts(None, None, 60, db, plant, STORE)
        assert [state["month"] for state in listing["month_end"]] == ["2026-08"] and listing["month_end"][0]["can_start"] is True
        # A later month closed: an earlier month can no longer be counted (its variance would rewrite history).
        lock_books_month(BooksLockPayload(month="2026-09"), db, plant, OWNER)
        _refused(lambda: start_count(CountCreate(kind="MONTH_END", month="2026-08"), db, plant, STORE), 409, "September 2026 is already closed")
        listing = list_counts(None, None, 60, db, plant, STORE)
        state = listing["month_end"][-1]
        assert state["month"] == "2026-10" and state["can_start"] is False and "opens on 29 Oct 2026" in state["note"]
        monkeypatch.setattr(stock_count, "ist_today", lambda: date(2026, 10, 29))
        october = start_count(CountCreate(kind="MONTH_END", month="2026-10"), db, plant, STORE)
        assert october["kind"] == "MONTH_END" and october["existing"] is False

        # Two people start the same month-end count at once: the second one joins the first (no 500).
        real = stock_count._month_end_count
        calls = {"n": 0}

        def racing(db_, plant_, month):
            calls["n"] += 1
            return None if calls["n"] == 1 else real(db_, plant_, month)

        monkeypatch.setattr(stock_count, "_month_end_count", racing)
        monkeypatch.setattr(stock_count, "_overlapping_count", lambda *args, **kwargs: None)
        again = start_count(CountCreate(kind="MONTH_END", month="2026-10"), db, plant, OPERATOR)
        assert again["id"] == october["id"] and again["existing"] is True


def test_one_open_count_per_rack():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper, glue = _item(db, plant), _item(db, plant, "ADHESIVE", tracking="BULK")
        a, b = _rack(db, plant, "OC-A-01"), _rack(db, plant, "OC-B-01")
        _reel(db, plant, paper, 300, at=a)
        _lot(db, plant, glue, 20, at=a)
        db.commit()
        first = start_count(CountCreate(kind="SPOT", location_ids=[a.id], item_ids=[paper.id]), db, plant, OPERATOR)
        error = _refused(lambda: start_count(CountCreate(kind="SPOT", location_ids=[a.id, b.id]), db, plant, STORE), 409, "OC-A-01 is already in spot count")
        assert error.detail["code"] == "RACK_IN_OPEN_COUNT" and error.detail["count_id"] == first["id"]
        _refused(lambda: start_count(CountCreate(kind="SPOT"), db, plant, STORE), 409, "already in spot count")
        # Another rack is fine, and so is joining the open count from the rack page.
        assert start_count(CountCreate(kind="SPOT", location_ids=[b.id]), db, plant, STORE)["existing"] is False
        assert start_count(CountCreate(kind="SPOT", location_ids=[a.id], join_open=True), db, plant, STORE)["id"] == first["id"]
        # A spot count of other materials on the same rack does not overlap (the first one counts paper only).
        glue_only = start_count(CountCreate(kind="SPOT", item_ids=[glue.id]), db, plant, STORE)
        assert glue_only["id"] != first["id"]


def test_lot_that_arrives_during_a_count_is_never_written_off():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper, glue = _item(db, plant), _item(db, plant, "ADHESIVE", tracking="BULK")
        rack, other = _rack(db, plant, "AR-A-01"), _rack(db, plant, "AR-B-01")
        there = _lot(db, plant, glue, 25, at=rack)
        used = _lot(db, plant, glue, 15, at=rack)
        reel = _reel(db, plant, paper, 400, at=other)
        db.commit()
        count = start_count(CountCreate(kind="SPOT", location_ids=[rack.id]), db, plant, OPERATOR)
        cid = uuid.UUID(count["id"])
        start_rack(cid, str(rack.id), db, plant, STORE)
        # Counted, then part of it went to the floor: labelled "issued after it was counted", and the label stays.
        scan_in_count(ScanPayload(rack=str(rack.id), code=used.batch_no, counted_qty=15, client_ref="ar-1"), cid, db, plant, OPERATOR)
        db.add(StockTransaction(item_id=glue.id, batch_id=used.id, transaction_type="ISSUE_PRODUCTION", qty_change=-6, reference_type="INTERNAL",
                                reference_id=used.id, plant_id=plant, effective_date=date.today(), created_at=datetime.utcnow() + timedelta(seconds=1)))
        # A GRN onto the rack and a put-away from another rack, both after counting there started.
        received = _lot(db, plant, glue, 40, at=rack, day=date.today())
        apply_move(db, plant_id=plant, entity_type="REEL", entity=reel, location=rack, actor="store@example.com", source="SCAN_MOVE")
        db.commit()
        view = stock_count.get_rack(cid, str(rack.id), db, plant, STORE)
        late = {row["id"] for row in view["expected"] if row["arrived_during_count"]}
        assert late == {str(received.id), str(reel.id)} and view["rack"]["progress"]["to_find"] == 1
        assert next(row for row in view["entries"] if row["entity_id"] == str(used.id))["movement_word"] == "Issued after it was counted"
        done = _count_rack(db, plant, cid, rack)
        assert done["marked_missing"] == 1 and done["marked_arrived"] == 2
        lines = {str(row.batch_id or row.reel_id): row for row in db.query(StockCountEntry).filter_by(count_id=cid).all()}
        assert lines[str(received.id)].status == "ARRIVED" and lines[str(received.id)].movement_flag == "RECEIVED_DURING_COUNT"
        assert lines[str(there.id)].status == "MISSING"
        _approve(db, plant, cid)
        db.expire_all()
        assert batch_balances(db, [received.id])[str(received.id)] == 40 and db.get(PaperReel, reel.id).current_weight_kg == 400
        assert batch_balances(db, [there.id])[str(there.id)] == 0
        detail = get_count(cid, db, plant, OWNER)
        assert detail["summary"]["arrived"] == 2 and detail["summary"]["missing"] == 1
        # After approval the record still says what moved during the count; the issue itself is never undone.
        assert next(row for row in detail["entries"] if row["entity_id"] == str(used.id))["movement_word"] == "Issued after it was counted"
        assert batch_balances(db, [used.id])[str(used.id)] == 9


def test_count_and_correction_on_one_lot_post_the_difference_once():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        boxes = _item(db, plant, "PACKAGING", tracking="BULK", uom="PCS")
        rack = _rack(db, plant, "CC-A-01")
        lot = _lot(db, plant, boxes, 5, at=rack)
        bulk = _lot(db, plant, boxes, 298, at=rack)
        db.commit()
        # A count measures 4 (book 5); before the Owner approves it, a correction to 4 is approved.
        count = start_count(CountCreate(kind="SPOT", location_ids=[rack.id], item_ids=[boxes.id]), db, plant, OPERATOR)
        cid = uuid.UUID(count["id"])
        scan_in_count(ScanPayload(rack=str(rack.id), code=lot.batch_no, counted_qty=4, client_ref="cc-1"), cid, db, plant, OPERATOR)
        scan_in_count(ScanPayload(rack=str(rack.id), code=bulk.batch_no, counted_qty=298, client_ref="cc-2"), cid, db, plant, OPERATOR)
        _count_rack(db, plant, cid, rack)
        fix = raise_correction(CorrectionPayload(code=lot.batch_no, new_qty=4, reason="COUNT_SHORT"), db, plant, STORE)
        # A second waiting correction on the same lot is refused.
        _refused(lambda: raise_correction(CorrectionPayload(code=lot.batch_no, new_qty=3, reason="COUNT_SHORT"), db, plant, GRN), 409, "already has a correction waiting")
        lookup = correction_lookup(lot.batch_no, db, plant, STORE)
        assert lookup["qty"] == 5 and lookup["waiting"]["voucher_no"] == fix["voucher_no"] and lookup["location_code"] == "CC-A-01"
        approve_correction(uuid.UUID(fix["id"]), CorrectionDecisionPayload(), db, plant, OWNER)
        _approve(db, plant, cid)
        db.expire_all()
        assert batch_balances(db, [lot.id])[str(lot.id)] == 4  # counted 4: never 3

        # A correction raised before a count posted the same difference has nothing left to post.
        late = raise_correction(CorrectionPayload(code=bulk.batch_no, new_qty=297, reason="COUNT_SHORT"), db, plant, STORE)
        recount = start_count(CountCreate(kind="SPOT", location_ids=[rack.id], item_ids=[boxes.id]), db, plant, OPERATOR)
        rid = uuid.UUID(recount["id"])
        scan_in_count(ScanPayload(rack=str(rack.id), code=bulk.batch_no, counted_qty=297, client_ref="cc-3"), rid, db, plant, OPERATOR)
        scan_in_count(ScanPayload(rack=str(rack.id), code=lot.batch_no, counted_qty=4, client_ref="cc-4"), rid, db, plant, OPERATOR)
        _count_rack(db, plant, rid, rack)
        _approve(db, plant, rid)
        waiting = next(row for row in list_corrections("DRAFT", db, plant, OWNER)["items"] if row["id"] == late["id"])
        assert waiting["lines"][0]["changed_since"] == -1 and waiting["lines"][0]["still_to_post"] == 0
        _refused(lambda: approve_correction(uuid.UUID(late["id"]), CorrectionDecisionPayload(), db, plant, OWNER), 409, "Nothing left to correct")
        db.expire_all()
        assert batch_balances(db, [bulk.id])[str(bulk.id)] == 297


def test_loose_lines_need_a_quantity_and_a_retry_adds_once():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "LS-A-01")
        db.commit()
        count = start_count(CountCreate(kind="SPOT", location_ids=[rack.id]), db, plant, OPERATOR)
        cid = uuid.UUID(count["id"])
        payload = LoosePayload(rack=str(rack.id), item_id=glue.id, counted_qty=5, client_ref="loose-same")
        first = add_loose_stock(payload, cid, db, plant, STORE)
        again = add_loose_stock(payload, cid, db, plant, STORE)  # a double tap / retry: same sheet key
        assert first["entry"]["id"] == again["entry"]["id"]
        assert db.query(StockCountEntry).filter_by(count_id=cid, entity_type="LOOSE").count() == 1
        _refused(lambda: update_entry(EntryUpdate(counted_qty=0), cid, uuid.UUID(first["entry"]["id"]), db, plant, STORE), 422, "above zero")
        update_entry(EntryUpdate(counted_qty=7), cid, uuid.UUID(first["entry"]["id"]), db, plant, STORE)
        _count_rack(db, plant, cid, rack)
        approved = _approve(db, plant, cid)
        assert approved["status"] == "APPROVED"
        entry = db.query(StockCountEntry).filter_by(count_id=cid, entity_type="LOOSE").one()
        made = db.get(StockBatch, entry.created_batch_id)
        assert made.stock_status == "QC_HOLD" and batch_balances(db, [made.id])[str(made.id)] == 7
        # The new lot has a number and a label to print.
        line = next(row for row in approved["entries"] if row["id"] == str(entry.id))
        assert line["created_lot_code"] == made.batch_no and line["created_lot_type"] == "BATCH"
        labels = lots_for_labels(str(made.id), db, plant, STORE)
        assert labels["items"][0]["code"] == made.batch_no and labels["items"][0]["held"] is True and labels["can"]["manage"] is True


def test_month_end_count_never_changes_a_lot_before_it_came_in(monkeypatch):
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        rack = _rack(db, plant, "ML-A-01")
        old = _reel(db, plant, paper, 500, at=rack, inward=date(2026, 9, 5))
        new = _reel(db, plant, paper, 300, at=rack, inward=date(2026, 10, 3))
        db.commit()
        monkeypatch.setattr(stock_count, "ist_today", lambda: date(2026, 10, 6))
        count = start_count(CountCreate(kind="MONTH_END", month="2026-09"), db, plant, STORE)
        cid = uuid.UUID(count["id"])
        scan_in_count(ScanPayload(rack=str(rack.id), code=old.reel_code, counted_qty=490, client_ref="ml-1"), cid, db, plant, STORE)
        scan_in_count(ScanPayload(rack=str(rack.id), code=new.reel_code, counted_qty=295, client_ref="ml-2"), cid, db, plant, STORE)
        _count_rack(db, plant, cid, rack)
        _count_rack(db, plant, cid, "unassigned")
        approved = _approve(db, plant, cid)
        assert approved["status"] == "CERTIFIED" and [row["effective_date"] for row in approved["vouchers"]] == ["2026-09-30", "2026-10-06"]
        september = book_period(db, plant, date(2026, 9, 1), date(2026, 9, 30))
        row = _row(september, paper)
        assert row["closing"] == 490 and row["count_variance"] == -10 and row["identity_ok"]
        october = book_period(db, plant, date(2026, 10, 1), date(2026, 10, 31))
        assert _row(october, paper)["count_variance"] == -5 and _row(october, paper)["identity_ok"]


def test_moves_change_only_the_place_except_the_fg_hold_release():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        fg = _item(db, plant, "FINISHED_GOOD", tracking="BULK", uom="PCS")
        rack, bay = _rack(db, plant, "MV-A-01"), _rack(db, plant, "MV-DSP", purpose="DISPATCH")
        drum = _lot(db, plant, glue, 30, at=rack)
        cartons = _lot(db, plant, fg, 100, status="QC_HOLD")
        db.commit()
        _refused(lambda: create_stock_move(StockMoveCreate(entity_type="BATCH", entity_id=drum.id, stock_status="DISPATCH_STAGING"), db, plant, GRN), 409, "only the place")
        _refused(lambda: create_stock_move(StockMoveCreate(entity_type="BATCH", entity_id=drum.id, to_location_id=bay.id), db, plant, STORE), 409, "dispatch bay")
        _refused(lambda: scan_move(ScanMovePayload(to_location_id=bay.id, code=drum.batch_no, client_ref="mv-1"), db, plant, STORE), 409, "dispatch bay")
        # A held lot keeps its hold through a plain move (400, as before) and a QC role cannot move stock.
        _refused(lambda: create_stock_move(StockMoveCreate(entity_type="BATCH", entity_id=cartons.id, stock_status="UNRESTRICTED"), db, plant, STORE), 400, "QC_HOLD")
        _refused(lambda: create_stock_move(StockMoveCreate(entity_type="BATCH", entity_id=drum.id, to_location_id=rack.id), db, plant, QC), 403)
        # Production's server-to-server FG hold release (QC-REL-…) still clears the hold, also for a QC login.
        released = create_stock_move(StockMoveCreate(entity_type="BATCH", entity_id=cartons.id, to_location_id=bay.id, stock_status="UNRESTRICTED", external_ref=f"QC-REL-{uuid.uuid4().hex[:12]}"), db, plant, QC)
        assert released.stock_status == "UNRESTRICTED" and released.to_location_id == bay.id
        db.expire_all()
        assert db.get(StockBatch, drum.id).stock_status == "UNRESTRICTED" and db.get(StockBatch, drum.id).location_id == rack.id


def test_material_never_sits_where_no_count_looks():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack, bay = _rack(db, plant, "PU-A-01"), _rack(db, plant, "PU-DSP", purpose="DISPATCH")
        _lot(db, plant, glue, 12, at=rack)
        stray = _lot(db, plant, glue, 3, at=bay)  # left there before this release
        db.commit()
        _refused(lambda: update_location(rack.id, LocationUpdate(purpose="WIP"), db, plant, PLANT_HEAD), 409, "Move them to a store rack")
        _refused(lambda: update_location(rack.id, LocationUpdate(purpose="DISPATCH"), db, plant, PLANT_HEAD), 409, "of material")
        _refused(lambda: create_location(LocationCreate(code="PU-WIP", warehouse="FLOOR", purpose="WIP"), db, plant, STORE), 409, "issue desks")
        # A dispatch bay holding material is still counted.
        count = start_count(CountCreate(kind="SPOT"), db, plant, STORE)
        assert {rack_row["label"] for rack_row in count["racks"]} >= {"PU-A-01", "PU-DSP"}
        assert str(stray.id)


def test_stock_book_check_can_fail():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        drum = _lot(db, plant, glue, 10, day=date(2026, 10, 5))
        # A difference dated before the lot came in (what a back-dated count used to do).
        db.add(StockTransaction(item_id=glue.id, batch_id=drum.id, transaction_type="ADJUSTMENT", qty_change=-1, reference_type="ADJUSTMENT",
                                reference_id=drum.id, plant_id=plant, effective_date=date(2026, 9, 30), movement_metadata={"reason_code": "PHYSICAL_COUNT_VARIANCE"}))
        db.commit()
        september = _row(book_period(db, plant, date(2026, 9, 1), date(2026, 9, 30)), glue)
        assert september["closing"] == -1 and september["identity_ok"] is False and september["book_problem"] == "NEGATIVE"
        october = book_period(db, plant, date(2026, 10, 1), date(2026, 10, 31))
        assert _row(october, glue)["closing"] == 9

        boxes = _item(db, plant, "PACKAGING", tracking="BULK", uom="PCS")
        first, second = _lot(db, plant, boxes, 10, day=date(2026, 9, 2)), _lot(db, plant, boxes, 10, day=date(2026, 10, 2))
        db.add(StockTransaction(item_id=boxes.id, batch_id=second.id, transaction_type="ISSUE_PRODUCTION", qty_change=-4, reference_type="INTERNAL",
                                reference_id=second.id, plant_id=plant, effective_date=date(2026, 9, 20)))
        db.commit()
        row = _row(book_period(db, plant, date(2026, 9, 1), date(2026, 9, 30)), boxes)
        assert row["closing"] == 6 and row["book_problem"] == "LOT_BELOW_ZERO"  # total fine, one lot below zero
        assert str(first.id)
        # A ledger row the book does not read (a stray non-zero relocation) shows as a difference.
        db.add(StockTransaction(item_id=boxes.id, batch_id=first.id, transaction_type="MOVE", qty_change=2, reference_type="INTERNAL",
                                reference_id=first.id, plant_id=plant, effective_date=date(2026, 10, 9)))
        db.commit()
        october = book_period(db, plant, date(2026, 10, 1), date(2026, 10, 31))
        assert _row(october, boxes)["book_problem"] == "LEDGER" and any(unit["problem_items"] for unit in october["units"])


def test_month_end_count_of_a_bulk_lot_received_later_and_never_below_zero(monkeypatch):
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "MZ-A-01")
        old = _lot(db, plant, glue, 10, at=rack, day=date(2026, 9, 5))
        late = _lot(db, plant, glue, 100, at=rack, day=date(2026, 10, 25))  # the PS-150 case: a lot received after the month end
        # Found extra on the old lot in October: the live book (30) is more than it ever held in September (10).
        db.add(StockTransaction(item_id=glue.id, batch_id=old.id, transaction_type="ADJUSTMENT", qty_change=20, reference_type="ADJUSTMENT",
                                reference_id=old.id, plant_id=plant, effective_date=date(2026, 10, 2), movement_metadata={"reason_code": "COUNT_EXTRA"}))
        db.commit()
        monkeypatch.setattr(stock_count, "ist_today", lambda: date(2026, 10, 28))
        count = start_count(CountCreate(kind="MONTH_END", month="2026-09"), db, plant, STORE)
        cid = uuid.UUID(count["id"])
        scan_in_count(ScanPayload(rack=str(rack.id), code=late.batch_no, counted_qty=40, client_ref="mz-1"), cid, db, plant, STORE)
        scan_in_count(ScanPayload(rack=str(rack.id), code=old.batch_no, counted_qty=0, client_ref="mz-2"), cid, db, plant, STORE)
        _count_rack(db, plant, cid, rack)
        _count_rack(db, plant, cid, "unassigned")
        submit_count(NotePayload(), cid, db, plant, STORE)
        # −30 on the old lot dated 30 Sep would leave it at −20 in September: refused, nothing posted.
        _refused(lambda: approve_count(NotePayload(), cid, db, plant, OWNER), 409, "below zero")
        db.rollback()
        assert db.get(stock_count.InventoryCertification, cid).status == "SUBMITTED"
        assert not db.query(StockAdjustmentVoucher).filter(StockAdjustmentVoucher.count_id == cid).count()
        # Recounted so the old lot is not written off: the late lot's −60 posts on the approval day, never in September.
        entry = db.query(StockCountEntry).filter(StockCountEntry.count_id == cid, StockCountEntry.client_ref == "mz-2").one()
        entry.counted_qty, entry.variance_qty = 30, 0
        db.commit()
        approved = approve_count(NotePayload(), cid, db, plant, OWNER)
        assert approved["status"] == "CERTIFIED" and [row["effective_date"] for row in approved["vouchers"]] == ["2026-10-28"]
        september = _row(book_period(db, plant, date(2026, 9, 1), date(2026, 9, 30)), glue)
        assert september["closing"] == 10 and september["count_variance"] == 0 and september["identity_ok"]
        october = _row(book_period(db, plant, date(2026, 10, 1), date(2026, 10, 31)), glue)
        assert october["opening"] == 10 and october["count_variance"] == -60 and october["closing"] == 70


def test_old_voucher_endpoint_never_adds_cleared_stock_or_takes_off_without_a_lot():
    from src.routers.stock_control import AdjustmentVoucherPayload, create_adjustment_voucher
    from src.services.locations import default_receiving_location

    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK", uom="PCS")
        db.commit()
        draft = create_adjustment_voucher(AdjustmentVoucherPayload(effective_date=date.today(), reason_code="OTHER", reason_notes="found", lines=[
            {"item_id": glue.id, "qty_delta": 5, "stock_status": "UNRESTRICTED"}]), db, plant, GRN)
        store = default_receiving_location(db, plant)
        line = draft["lines"][0]
        assert draft["status"] == "DRAFT" and line["stock_status"] == "QC_HOLD" and line["location_id"] == str(store.id)
        posted = approve_correction(uuid.UUID(draft["id"]), CorrectionDecisionPayload(), db, plant, OWNER)
        lot = db.get(StockBatch, uuid.UUID(posted["lines"][0]["created_batch_id"]))
        assert lot.stock_status == "QC_HOLD" and lot.location_id == store.id and lot.batch_no.startswith("ADJ-") and not lot.batch_no.startswith("ADJ-ADJ-")
        _refused(lambda: create_adjustment_voucher(AdjustmentVoucherPayload(effective_date=date.today(), reason_code="COUNT_SHORT", lines=[
            {"item_id": glue.id, "qty_delta": -1}]), db, plant, GRN), 422, "name the reel or lot")
        _refused(lambda: create_adjustment_voucher(AdjustmentVoucherPayload(effective_date=date.today(), reason_code="PHYSICAL_COUNT_VARIANCE", lines=[
            {"item_id": glue.id, "qty_delta": 1, "batch_id": lot.id}]), db, plant, OWNER), 422, "only from an approved stock count")
        db.rollback()
        # A gain never shows as a count difference, and the lot total and the item total stay equal.
        row = _row(book_period(db, plant, date.today().replace(day=1), date.today()), glue)
        assert row["count_variance"] == 0 and row["corrections"] == 5 and row["identity_ok"]
