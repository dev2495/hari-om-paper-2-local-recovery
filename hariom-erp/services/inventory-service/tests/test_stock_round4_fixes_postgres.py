"""Checker round 4 (2026-10-30) on stock: the old voucher post path, counts and later moves, the RM store
purpose, open old-style reel issues, the stock-book place of a movement, month keys, the brief counts list,
IST days for the book start and voucher numbering under concurrency (live PostgreSQL)."""
import os
import threading
import uuid
from datetime import date, datetime, timedelta

import pytest

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema, ensure_stock_count_and_schedule_schema
from src.database import Base, SessionLocal, engine
from src.models import PaperReel, ReelIssue, ReelIssueStatus, ReelScanEvent, ReelStatus, StockAdjustmentLine, StockAdjustmentVoucher, StockTransaction
from src.routers.locations import LocationUpdate, update_location
from src.routers.stock_control import (
    CorrectionPayload, month_figure_sources, post_adjustment_voucher, raise_correction,
)
from src.routers.stock_count import (
    CountCreate, NotePayload, ScanPayload, _first_stock_month, approve_count, finish_rack, get_count, list_counts, scan_in_count,
    start_count, submit_count,
)
from src.routers.stock_moves import ScanMovePayload, scan_move
from src.services.books import ist_today
from src.services.locations import default_receiving_location
from src.services.stock_control import book_period

from test_stock_count_flow_postgres import OWNER, STORE, _item, _lot, _rack, _reel, _refused, _row

GRN = {"sub": "grn@example.com", "roles": ["GRN"], "actual_roles": ["GRN"], "role": "GRN", "token": ""}


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()
    ensure_stock_count_and_schedule_schema()


def test_old_post_path_posts_a_waiting_correction_once_dated_today_and_re_based():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        rack = _rack(db, plant, "R4-A-01")
        reel = _reel(db, plant, paper, 500, at=rack)
        db.commit()
        draft = raise_correction(CorrectionPayload(code=reel.reel_code, new_qty=480, reason="COUNT_SHORT"), db, plant, STORE)
        header = db.get(StockAdjustmentVoucher, uuid.UUID(draft["id"]))
        header.effective_date = date(2026, 1, 5)  # raised long ago
        # Since it was raised another posting took 5 kg off the same reel: only the rest (-15) is posted.
        other = StockAdjustmentVoucher(plant_id=plant, voucher_no=f"ADJ-OTHER-{uuid.uuid4().hex[:4]}", effective_date=ist_today(),
                                       reason_code="DAMAGED_IN_STORE", source_type="CORRECTION", attachment_refs=[], created_by="x",
                                       status="POSTED", posted_at=datetime.utcnow() + timedelta(seconds=1))
        db.add(other)
        db.flush()
        db.add(StockAdjustmentLine(adjustment_id=other.id, item_id=paper.id, reel_id=reel.id, qty_delta=-5, stock_status="UNRESTRICTED", reason_code="DAMAGED_IN_STORE"))
        db.get(PaperReel, reel.id).current_weight_kg = 495
        db.commit()

        posted = post_adjustment_voucher(uuid.UUID(draft["id"]), db, plant, OWNER)
        assert posted["status"] == "POSTED" and posted["effective_date"] == ist_today().isoformat()
        assert posted["lines"][0]["qty_delta"] == -15
        db.expire_all()
        assert db.get(PaperReel, reel.id).current_weight_kg == 480
        # A double submit (or a retry after a timeout) returns the posted voucher and changes nothing.
        again = post_adjustment_voucher(uuid.UUID(draft["id"]), db, plant, OWNER)
        db.expire_all()
        assert again["status"] == "POSTED" and db.get(PaperReel, reel.id).current_weight_kg == 480
        events = db.query(ReelScanEvent).filter(ReelScanEvent.reel_id == reel.id).all()
        assert sum(1 for event in events if (event.event_metadata or {}).get("adjustment_id") == draft["id"]) == 1


def test_old_post_path_waits_for_the_row_lock_on_a_concurrent_double_submit():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        lot = _lot(db, plant, glue, 50, at=_rack(db, plant, "R4-L-01"))
        lot_id, lot_no = lot.id, lot.batch_no
        db.commit()
        draft = raise_correction(CorrectionPayload(code=lot_no, new_qty=40, reason="COUNT_SHORT"), db, plant, STORE)
    results: list = []

    def submit():
        with SessionLocal() as session:
            try:
                results.append(post_adjustment_voucher(uuid.UUID(draft["id"]), session, plant, OWNER)["status"])
            except Exception as exc:  # pragma: no cover - a failure is reported below
                results.append(repr(exc))

    threads = [threading.Thread(target=submit) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)
    assert results == ["POSTED", "POSTED"], results
    with SessionLocal() as db:
        rows = db.query(StockTransaction).filter(StockTransaction.batch_id == lot_id, StockTransaction.transaction_type == "ADJUSTMENT").all()
        assert [row.qty_change for row in rows] == [-10]


def test_a_count_posting_is_approved_on_its_count_not_on_the_old_path():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        header = StockAdjustmentVoucher(plant_id=plant, voucher_no=f"VAR-T-{uuid.uuid4().hex[:4]}", effective_date=ist_today(),
                                        reason_code="PHYSICAL_COUNT_VARIANCE", source_type="STOCK_COUNT", attachment_refs=[], created_by="x", status="DRAFT")
        db.add(header)
        db.commit()
        _refused(lambda: post_adjustment_voucher(header.id, db, plant, OWNER), 409, "Open the count")


def test_same_moment_raises_get_different_numbers():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "R4-N-01")
        codes = [_lot(db, plant, glue, 20, at=rack).batch_no for _ in range(3)]
        db.commit()
    numbers: list = []
    start = threading.Barrier(3)

    def raise_one(code):
        with SessionLocal() as session:
            start.wait(10)
            try:
                numbers.append(raise_correction(CorrectionPayload(code=code, new_qty=15, reason="COUNT_SHORT"), session, plant, STORE)["voucher_no"])
            except Exception as exc:  # pragma: no cover
                numbers.append(repr(exc))

    threads = [threading.Thread(target=raise_one, args=(code,)) for code in codes]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(30)
    assert len(numbers) == 3 and len(set(numbers)) == 3 and all(str(value).startswith("ADJ-") for value in numbers), numbers


def test_count_approval_never_moves_a_lot_back_after_a_real_later_move():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        first, second = _rack(db, plant, "R4-M-01"), _rack(db, plant, "R4-M-02")
        moved = _reel(db, plant, paper, 300, at=first)
        stays = _reel(db, plant, paper, 200, at=second)  # counted on R4-M-01: really in the wrong place
        gone = _reel(db, plant, paper, 150, at=first)    # not scanned (missing), then scan-moved: it was there
        db.commit()
        count = start_count(CountCreate(kind="SPOT", location_ids=[first.id]), db, plant, STORE)
        cid = uuid.UUID(count["id"])
        scan_in_count(ScanPayload(rack=str(first.id), code=moved.reel_code, counted_qty=298, client_ref="mv-1"), cid, db, plant, STORE)
        scan_in_count(ScanPayload(rack=str(first.id), code=stays.reel_code, client_ref="mv-2"), cid, db, plant, STORE)
        finish_rack(cid, str(first.id), db, plant, STORE)
        # After the count, the store really moves two reels to the second rack.
        scan_move(ScanMovePayload(to_location_id=second.id, code=moved.reel_code, client_ref="mv-after-1"), db, plant, GRN)
        scan_move(ScanMovePayload(to_location_id=second.id, code=gone.reel_code, client_ref="mv-after-2"), db, plant, GRN)
        submit_count(NotePayload(), cid, db, plant, STORE)

        review = {entry["code"]: entry for entry in get_count(cid, db, plant, OWNER)["entries"]}
        assert review[moved.reel_code]["movement_flag"] == "MOVED_AFTER_COUNT"
        assert "after it was counted" in review[moved.reel_code]["movement_word"] and "R4-M-02" in review[moved.reel_code]["movement_word"]
        assert review[gone.reel_code]["movement_flag"] == "MOVED_AFTER_COUNT"
        assert review[stays.reel_code]["movement_flag"] is None

        approved = approve_count(NotePayload(), cid, db, plant, OWNER)
        db.expire_all()
        assert db.get(PaperReel, moved.id).location_id == second.id  # keeps its newer place
        assert db.get(PaperReel, moved.id).current_weight_kg == 298  # the re-weigh still posts
        assert db.get(PaperReel, stays.id).location_id == first.id   # a real wrong place is filed where it was found
        assert db.get(PaperReel, gone.id).current_weight_kg == 150   # seen after the count: never written off
        lines = {entry["code"]: entry for entry in approved["entries"]}
        assert lines[moved.reel_code]["movement_flag"] == "MOVED_AFTER_COUNT" and lines[gone.reel_code]["movement_flag"] == "MOVED_AFTER_COUNT"
        events = db.query(ReelScanEvent).filter(ReelScanEvent.reel_id == moved.id).all()
        assert not [event for event in events if (event.event_metadata or {}).get("source") == "COUNT"]


def test_the_rm_store_is_never_a_dispatch_bay_or_scrap_area():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        store = default_receiving_location(db, plant)
        bay, scrap = _rack(db, plant, "R4-DSP", purpose="DISPATCH"), _rack(db, plant, "R4-SCR", purpose="SCRAP")
        qc = _rack(db, plant, "R4-QC", purpose="QC")
        db.commit()
        _refused(lambda: update_location(bay.id, LocationUpdate(is_receiving_default=True), db, plant, STORE), 409, "store rack or QC bay")
        db.rollback()
        _refused(lambda: update_location(scrap.id, LocationUpdate(is_receiving_default=True), db, plant, STORE), 409, "store rack or QC bay")
        db.rollback()
        _refused(lambda: update_location(store.id, LocationUpdate(purpose="DISPATCH"), db, plant, STORE), 409, "is the RM store")
        db.rollback()
        _refused(lambda: update_location(store.id, LocationUpdate(purpose="SCRAP"), db, plant, STORE), 409, "is the RM store")
        db.rollback()
        assert update_location(qc.id, LocationUpdate(is_receiving_default=True), db, plant, STORE)["is_receiving_default"] is True
        # Older data where the default became a dispatch bay: goods inward never uses it.
        qc_row = db.get(type(qc), qc.id)
        qc_row.purpose = "DISPATCH"
        db.commit()
        chosen = default_receiving_location(db, plant)
        assert chosen.id != qc.id and str(chosen.purpose).upper() == "STORAGE" and chosen.is_receiving_default


def test_open_old_style_reel_issue_is_issued_in_full_on_its_issue_date():
    plant = str(uuid.uuid4())
    today = ist_today()
    start = today.replace(day=1)
    with SessionLocal() as db:
        paper = _item(db, plant)
        open_reel = _reel(db, plant, paper, 400, inward=start)
        closed_reel = _reel(db, plant, paper, 300, inward=start)
        open_reel.status = ReelStatus.ISSUED  # old flow: the weight stays on the reel while it is out
        db.add(ReelIssue(plant_id=uuid.UUID(plant), reel_id=open_reel.id, issue_section="WINDER_SECTION", shift="A", issue_date=start,
                         issued_weight_kg=400, consumed_weight_kg=0, remaining_weight_kg=0, status=ReelIssueStatus.OPEN, issue_mode="LEGACY"))
        # A closed old issue used 250 of 300 kg; the old flow put 50 kg back on the reel.
        db.add(ReelIssue(plant_id=uuid.UUID(plant), reel_id=closed_reel.id, issue_section="WINDER_SECTION", shift="A", issue_date=start,
                         issued_weight_kg=300, consumed_weight_kg=250, remaining_weight_kg=50, status=ReelIssueStatus.CLOSED, issue_mode="LEGACY",
                         closed_at=datetime.utcnow()))
        closed_reel.current_weight_kg = 50
        db.commit()
        row = _row(book_period(db, plant, start, today), paper)
        assert row["received"] == 700 and row["issued"] == 700 and row["corrections"] == 50, row
        assert row["closing"] == 50 and row["identity_ok"], row


def test_stock_book_rows_show_the_place_at_that_movement():
    plant = str(uuid.uuid4())
    today = ist_today()
    with SessionLocal() as db:
        paper = _item(db, plant)
        store, rack = _rack(db, plant, "R4-S-IN"), _rack(db, plant, "R4-S-02")
        reel = _reel(db, plant, paper, 250, at=store, inward=today)
        db.commit()
        scan_move(ScanMovePayload(to_location_id=rack.id, code=reel.reel_code, client_ref="place-1"), db, plant, GRN)
        sources = month_figure_sources(paper.id, today.strftime("%Y-%m"), db, plant, OWNER)
        received = next(row for row in sources["rows"] if row["kind"] == "RECEIVED")
        assert received["location_code"] == "R4-S-IN", received


def test_month_keys_are_checked_and_the_brief_list_is_one_query():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        _reel(db, plant, paper, 100, at=_rack(db, plant, "R4-K-01"), inward=date(2026, 5, 3))
        db.commit()
        for bad in ("2026-5", "2026-05-01", "26-05", "2026-13"):
            _refused(lambda: start_count(CountCreate(kind="MONTH_END", month=bad), db, plant, STORE), 422, "YYYY-MM")
        made = start_count(CountCreate(kind="MONTH_END", month="2026-05"), db, plant, STORE)
        brief = list_counts("DRAFT,SUBMITTED,APPROVED,CERTIFIED", "MONTH_END", 200, db, plant, STORE, True)
        assert brief["items"] == [{"id": made["id"], "count_no": made["count_no"], "kind": "MONTH_END", "month": "2026-05", "status": "DRAFT",
                                   "approved_by": None, "approved_at": None}]
        assert "month_end" not in brief
        full = list_counts(None, None, 60, db, plant, STORE, False)
        assert full["items"][0]["racks_total"] >= 1 and full["month_end"]


def test_book_start_uses_the_ist_day_of_a_row_with_no_business_date():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        # 31 Oct 20:00 UTC is 1 Nov 01:30 in India: the book starts in November, not October.
        db.add(StockTransaction(item_id=glue.id, transaction_type="INWARD", qty_change=5, reference_type="PURCHASE", reference_id=uuid.uuid4(),
                                plant_id=plant, created_at=datetime(2026, 10, 31, 20, 0)))
        db.commit()
        assert _first_stock_month(db, plant) == date(2026, 11, 1)


# ------------------------------------------------------------------------------- checker round 2 (30 Oct)


def test_a_waiting_gain_approved_after_the_reel_went_to_the_floor_is_refused():
    """Nothing returns from the floor: a + correction raised before a whole-reel floor issue must not put
    the issued weight back into store stock when the Owner approves it later (either post path)."""
    from src.routers.reel_issues import ReelIssueCreate, create_reel_issue
    from src.routers.stock_control import CorrectionDecisionPayload, approve_correction, list_corrections

    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        rack = _rack(db, plant, "R5-F-01")
        reel = _reel(db, plant, paper, 500, at=rack)
        reel.current_weight_kg = 480  # an earlier correction took 20 kg off
        db.commit()
        plus = raise_correction(CorrectionPayload(code=reel.reel_code, new_qty=500, reason="LABEL_LOST_FOUND"), db, plant, STORE)
        create_reel_issue(ReelIssueCreate(reel_id=reel.id, shift="A", issue_date=ist_today()), db, plant, STORE)
        db.expire_all()
        assert float(db.get(PaperReel, reel.id).current_weight_kg or 0) == 0

        # The Owner sees before approving that it was issued and approving posts nothing.
        waiting = next(row for row in list_corrections("DRAFT", db, plant, OWNER)["items"] if row["id"] == plus["id"])
        from src.services.shift_rule import floor_shift_now
        assert waiting["lines"][0]["issued_since"] == floor_shift_now().business_date.isoformat() and waiting["lines"][0]["still_to_post"] == 0

        refusal = _refused(lambda: approve_correction(uuid.UUID(plus["id"]), CorrectionDecisionPayload(), db, plant, OWNER), 409, "Nothing comes back from the floor")
        assert refusal.detail["code"] == "ISSUED_SINCE_RAISED"
        db.rollback()
        _refused(lambda: post_adjustment_voucher(uuid.UUID(plus["id"]), db, plant, OWNER), 409, "issued to the floor")
        db.rollback()
        db.expire_all()
        after = db.get(PaperReel, reel.id)
        assert after.status != ReelStatus.IN_STOCK and float(after.current_weight_kg or 0) == 0
        assert db.get(StockAdjustmentVoucher, uuid.UUID(plus["id"])).status == "DRAFT"


def test_a_written_off_reel_found_again_is_still_added_back():
    """The issue check is only for the floor: a reel the book wrote off (not issued) that turns up again
    is still brought back by its waiting correction."""
    from src.routers.stock_control import CorrectionDecisionPayload, approve_correction

    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        reel = _reel(db, plant, paper, 300, at=_rack(db, plant, "R5-W-01"))
        reel.current_weight_kg = 0
        db.commit()
        found = raise_correction(CorrectionPayload(code=reel.reel_code, new_qty=300, reason="LABEL_LOST_FOUND"), db, plant, STORE)
        approve_correction(uuid.UUID(found["id"]), CorrectionDecisionPayload(), db, plant, OWNER)
        db.expire_all()
        assert float(db.get(PaperReel, reel.id).current_weight_kg) == 300


def test_an_approved_count_keeps_naming_the_place_a_lot_was_moved_to_before_approval():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        first, second = _rack(db, plant, "R5-P-01"), _rack(db, plant, "R5-P-02")
        reel = _reel(db, plant, paper, 300, at=first)
        db.commit()
        count = start_count(CountCreate(kind="SPOT", location_ids=[first.id]), db, plant, STORE)
        cid = uuid.UUID(count["id"])
        scan_in_count(ScanPayload(rack=str(first.id), code=reel.reel_code, client_ref="pl-1"), cid, db, plant, STORE)
        finish_rack(cid, str(first.id), db, plant, STORE)
        scan_move(ScanMovePayload(to_location_id=second.id, code=reel.reel_code, client_ref="pl-after-1"), db, plant, GRN)
        submit_count(NotePayload(), cid, db, plant, STORE)
        approved = approve_count(NotePayload(), cid, db, plant, OWNER)
        line = next(entry for entry in approved["entries"] if entry["code"] == reel.reel_code)
        assert line["movement_flag"] == "MOVED_AFTER_COUNT" and "Rack R5-P-02" in line["movement_word"]

        # Later the store moves it back to the counted rack: the approved record still names R5-P-02.
        scan_move(ScanMovePayload(to_location_id=first.id, code=reel.reel_code, client_ref="pl-later-1"), db, plant, GRN)
        db.expire_all()
        line = next(entry for entry in get_count(cid, db, plant, OWNER)["entries"] if entry["code"] == reel.reel_code)
        assert "Rack R5-P-02" in line["movement_word"] and "R5-P-01" not in line["movement_word"], line["movement_word"]
