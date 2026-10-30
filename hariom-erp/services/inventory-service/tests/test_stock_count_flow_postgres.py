"""Stock book, counts by rack, corrections and locations (client 2026-10-28, live PostgreSQL).

Covers spec 2.1 (identity, FLOOR issues out on their issue date, IST days), 2.3 (any role counts, Owner
approves, exact lot posting, wrong place moves, issued-but-found, MONTH_END certificate and dating), 2.4
(corrections wait for the Owner) and 2.7 (locations, scan moves, put-away).
"""
import os
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema, ensure_stock_count_and_schedule_schema
from src.database import Base, SessionLocal, engine
from src.models import (
    InventoryCertification, InventoryCertificationLine, InventoryLocation, ItemMaster, PaperReel, ReelIssue, ReelIssueStatus,
    ReelScanEvent, ReelStatus, StockAdjustmentVoucher, StockBatch, StockCountEntry, StockCountLocation, StockTransaction,
)
from src.routers.books import BooksLockPayload, lock_books_month
from src.routers.locations import LocationUpdate, PutAwayAllPayload, get_location, locations_overview, put_away_all_unassigned, update_location
from src.routers.stock_control import (
    CorrectionDecisionPayload, CorrectionPayload, approve_correction, list_corrections, month_figure_sources, month_figures,
    raise_correction, reject_correction,
)
from src.routers.stock_count import (
    CountCreate, DecisionPayload, LoosePayload, NotePayload, ScanPayload, SendBackPayload, approve_count, decide_issued_found,
    finish_rack, get_count, get_rack, scan_in_count, send_back_count, start_count, submit_count, undo_entry,
)
from src.routers.stock_moves import ScanMovePayload, ScanMoveUndoPayload, StockMoveCreate, create_stock_move, scan_move, undo_scan_move
from src.services.books import ist_today
from src.services.stock_control import book_period
from src.utils.auth import require_owner

OPERATOR = {"sub": "operator@example.com", "roles": ["Operator"], "actual_roles": ["Operator"], "role": "Operator", "token": ""}
STORE = {"sub": "store@example.com", "roles": ["Store"], "actual_roles": ["Store"], "role": "Store", "token": ""}
PLANT_HEAD = {"sub": "pm@example.com", "roles": ["PlantManager"], "actual_roles": ["PlantManager"], "role": "PlantManager", "token": ""}
ADMIN = {"sub": "admin@example.com", "roles": ["Admin"], "actual_roles": ["Admin"], "role": "Admin", "token": ""}
OWNER = {"sub": "owner@example.com", "roles": ["Owner"], "actual_roles": ["Owner"], "role": "Owner", "token": ""}


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()
    ensure_stock_count_and_schedule_schema()


def _item(db, plant, kind="RAW_PAPER", *, tracking="REEL", uom="KG", cost=40.0):
    item = ItemMaster(item_code=f"{kind[:4]}-{uuid.uuid4().hex[:8]}", name=f"{kind.title()} {uuid.uuid4().hex[:4]}", type=kind,
                      tracking_mode=tracking, uom=uom, plant_id=plant, active="true", unit_cost=cost)
    db.add(item)
    db.flush()
    return item


def _rack(db, plant, code, purpose="STORAGE"):
    row = InventoryLocation(plant_id=plant, code=code, name=f"Rack {code}", warehouse="RAW MATERIAL STORE", purpose=purpose, active="true")
    db.add(row)
    db.flush()
    return row


def _reel(db, plant, item, kg, *, at=None, status="UNRESTRICTED", inward=date(2026, 10, 2)):
    reel = PaperReel(plant_id=uuid.UUID(plant), reel_code=f"AT-{uuid.uuid4().hex[:8].upper()}", paper_id=item.id, inward_weight_kg=kg,
                     current_weight_kg=kg, status=ReelStatus.IN_STOCK, stock_status=status, location_id=at.id if at else None,
                     inward_date=inward, unit_cost=40.0)
    db.add(reel)
    db.flush()
    return reel


def _lot(db, plant, item, qty, *, at=None, status="UNRESTRICTED", day=date(2026, 10, 2)):
    batch = StockBatch(item_id=item.id, batch_no=f"IN/26/{uuid.uuid4().hex[:5].upper()}-1", received_qty=qty, plant_id=plant,
                       stock_status=status, location_id=at.id if at else None, unit_cost=90.0)
    db.add(batch)
    db.flush()
    db.add(StockTransaction(item_id=item.id, batch_id=batch.id, transaction_type="INWARD", qty_change=qty, reference_type="PURCHASE",
                            reference_id=batch.id, plant_id=plant, stock_status=status, effective_date=day, movement_metadata={"grn_no": "IN/26/T"}))
    db.flush()
    return batch


def _floor_issue(db, plant, reel, day, *, section="SLITTING_SECTION", created=None):
    issue = ReelIssue(plant_id=uuid.UUID(plant), reel_id=reel.id, issue_section=section, shift="A", issue_date=day,
                      issued_weight_kg=reel.current_weight_kg, consumed_weight_kg=reel.current_weight_kg, remaining_weight_kg=0.0,
                      status=ReelIssueStatus.OPEN if section == "SLITTING_SECTION" else ReelIssueStatus.CLOSED, issue_mode="FLOOR",
                      created_at=created or datetime.utcnow())
    reel.current_weight_kg = 0.0
    reel.status = ReelStatus.CONSUMED
    db.add(issue)
    db.flush()
    return issue


def _refused(call, status, text=None):
    with pytest.raises(HTTPException) as error:
        call()
    assert error.value.status_code == status, error.value.detail
    if text:
        detail = error.value.detail if isinstance(error.value.detail, str) else error.value.detail.get("message", "")
        assert text in detail, detail
    return error.value


def _row(result, item):
    return next(row for row in result["items"] if row["item_id"] == str(item.id))


def test_book_identity_floor_issue_on_issue_date_and_ist_days():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        reel = _reel(db, plant, paper, 500, inward=date(2026, 9, 20))
        kept = _reel(db, plant, paper, 300, inward=date(2026, 9, 25))
        # A FLOOR slitting issue on 30 Sep (card not written, issue still OPEN) is out in September,
        # even though the server stamped it 30 Sep 20:00 UTC (= 1 Oct in India).
        _floor_issue(db, plant, reel, date(2026, 9, 30), created=datetime(2026, 9, 30, 20, 0))
        lot = _lot(db, plant, glue, 100, day=date(2026, 9, 10))
        db.add_all([
            StockTransaction(item_id=glue.id, batch_id=lot.id, transaction_type="ISSUE_PRODUCTION", qty_change=-30, reference_type="INTERNAL",
                             reference_id=lot.id, plant_id=plant, effective_date=date(2026, 9, 15)),
            StockTransaction(item_id=glue.id, batch_id=lot.id, transaction_type="ADJUSTMENT", qty_change=-10, reference_type="PURCHASE",
                             reference_id=lot.id, plant_id=plant, effective_date=date(2026, 10, 2), movement_metadata={"kind": "SUPPLIER_RETURN"}),
            StockTransaction(item_id=glue.id, batch_id=lot.id, transaction_type="ADJUSTMENT", qty_change=-5, reference_type="ADJUSTMENT",
                             reference_id=lot.id, plant_id=plant, effective_date=date(2026, 10, 5), movement_metadata={"reason_code": "PHYSICAL_COUNT_VARIANCE"}),
            StockTransaction(item_id=glue.id, transaction_type="OPENING", qty_change=20, reference_type="INTERNAL", reference_id=lot.id,
                             plant_id=plant, effective_date=date(2026, 10, 1)),
            StockTransaction(item_id=glue.id, batch_id=lot.id, transaction_type="ADJUSTMENT", qty_change=3, reference_type="ADJUSTMENT",
                             reference_id=lot.id, plant_id=plant, effective_date=date(2026, 10, 7), movement_metadata={"reason_code": "DAMAGED_IN_STORE"}),
            # No business date: its UTC stamp 31 Oct 19:00 is 1 Nov in India, so it belongs to November.
            StockTransaction(item_id=glue.id, batch_id=lot.id, transaction_type="ISSUE_PRODUCTION", qty_change=-4, reference_type="INTERNAL",
                             reference_id=lot.id, plant_id=plant, created_at=datetime(2026, 10, 31, 19, 0)),
        ])
        db.commit()

        september = book_period(db, plant, date(2026, 9, 1), date(2026, 9, 30))
        october = book_period(db, plant, date(2026, 10, 1), date(2026, 10, 31))
        november = book_period(db, plant, date(2026, 11, 1), date(2026, 11, 30))
        sp, op = _row(september, paper), _row(october, paper)
        assert (sp["received"], sp["issued"], sp["closing"]) == (800.0, 500.0, 300.0)
        assert op["opening"] == 300.0 and op["issued"] == 0.0 and op["closing"] == float(kept.current_weight_kg)
        sg, og, ng = _row(september, glue), _row(october, glue), _row(november, glue)
        assert (sg["received"], sg["issued"], sg["closing"]) == (100.0, 30.0, 70.0)
        assert og["opening"] == sg["closing"]
        assert (og["received"], og["opening_loads"], og["sent_back"], og["corrections"], og["count_variance"]) == (20.0, 20.0, 10.0, -2.0, -5.0)
        assert og["closing"] == 78.0 and og["actual_used"] == round(og["issued"] - og["corrections"], 3) == 2.0
        assert ng["opening"] == 78.0 and ng["issued"] == 4.0 and ng["closing"] == 74.0
        for result in (september, october, november):
            for row in result["items"]:
                assert row["closing"] == round(row["opening"] + row["received"] - row["sent_back"] - row["issued"] + row["corrections"], 3)
        # Totals are per unit and never mix units.
        assert {unit["uom"] for unit in october["units"]} == {"KG"}


def test_spot_count_by_any_role_owner_approves_exact_lots_and_moves():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack_a, rack_b = _rack(db, plant, "RM-A-01"), _rack(db, plant, "RM-B-01")
        _rack(db, plant, "WIP-01", purpose="WIP")
        found = _reel(db, plant, paper, 500, at=rack_a)
        missing = _reel(db, plant, paper, 400, at=rack_a, status="QC_HOLD")
        wrong = _reel(db, plant, paper, 300, at=rack_b, status="QC_HOLD")
        oldest = _reel(db, plant, paper, 250, at=rack_b, inward=date(2026, 9, 1))
        drum = _lot(db, plant, glue, 100, at=rack_a)
        loose_lot = _lot(db, plant, glue, 50)
        unfiled = _reel(db, plant, paper, 120)
        issued = _reel(db, plant, paper, 450, at=rack_a)
        _floor_issue(db, plant, issued, date(2026, 10, 20), section="WINDER_SECTION")
        db.commit()

        count = start_count(CountCreate(kind="SPOT"), db, plant, OPERATOR)
        cid = uuid.UUID(count["id"])
        assert count["status"] == "DRAFT" and {rack["label"] for rack in count["racks"]} == {"RM-A-01", "RM-B-01", "Not in any location"}

        def scan(rack, code, qty=None, ref=None, who=OPERATOR):
            return scan_in_count(ScanPayload(rack=rack, code=code, counted_qty=qty, client_ref=ref or uuid.uuid4().hex), cid, db, plant, who)

        a, b = str(rack_a.id), str(rack_b.id)
        first = scan(a, f"HARIOM|REEL|{plant}|{found.id}|{found.reel_code}", ref="scan-found")
        assert first["entry"]["status"] == "FOUND" and first["entry"]["expected_qty"] == 500 and first["entry"]["counted_by"] == OPERATOR["sub"]
        assert scan(a, found.reel_code, ref="scan-found")["replayed"] is True  # same client_ref: nothing new
        assert scan(a, f"https://erp.example/scan?c=HARIOM%7CREEL%7C{plant}%7C{wrong.id}%7C{wrong.reel_code}")["entry"]["status"] == "WRONG_PLACE"
        ask = scan(a, drum.batch_no)
        assert ask["needs_qty"] is True
        assert scan(a, drum.batch_no, qty=90)["entry"]["variance_qty"] == -10
        # Stock with no location found on a rack is simply found, and filed there on approval.
        filed = scan(a, unfiled.reel_code)
        assert filed["entry"]["status"] == "FOUND" and "filed here" in filed["result"]["detail"]
        flagged = scan(a, issued.reel_code)
        assert flagged["entry"]["status"] == "ISSUED_FOUND" and "Issued on 20 Oct 2026" in flagged["entry"]["note"]
        _refused(lambda: scan(a, f"HARIOM|LOC|{plant}|{rack_b.id}|RM-B-01"), 409, "rack label")
        _refused(lambda: scan(a, "NOT-A-LABEL"), 404)
        oops = scan(a, oldest.reel_code)
        undo_entry(cid, uuid.UUID(oops["entry"]["id"]), db, plant, OPERATOR)
        from src.routers.stock_count import add_loose_stock
        add_loose_stock(LoosePayload(rack=a, item_id=glue.id, counted_qty=5, client_ref="loose-1"), cid, db, plant, STORE)

        done = finish_rack(cid, a, db, plant, PLANT_HEAD)
        assert done["marked_missing"] == 1 and done["rack"]["status"] == "DONE"
        _refused(lambda: scan(a, oldest.reel_code), 409, "marked done")
        _refused(lambda: submit_count(NotePayload(), cid, db, plant, OPERATOR), 409, "not done yet")
        scan("unassigned", loose_lot.batch_no, qty=50)
        finish_rack(cid, "unassigned", db, plant, OPERATOR)
        finish_rack(cid, b, db, plant, OPERATOR)  # the oldest reel is not found on B
        submitted = submit_count(NotePayload(note="All racks counted"), cid, db, plant, OPERATOR)
        assert submitted["status"] == "SUBMITTED" and submitted["can"]["approve"] is False
        _refused(lambda: scan(a, found.reel_code), 409, "waiting for the Owner")
        # Only the real Owner approves: Admin and the plant head are refused.
        for who in (ADMIN, PLANT_HEAD, STORE):
            _refused(lambda: require_owner(who), 403, "Only the Owner")
        assert get_count(cid, db, plant, OWNER)["can"]["approve"] is True

        flagged_id = uuid.UUID(flagged["entry"]["id"])
        decide_issued_found(DecisionPayload(decision="ADD_ON_QC_HOLD"), cid, flagged_id, db, plant, OWNER)
        approved = approve_count(NotePayload(note="OK"), cid, db, plant, OWNER)
        assert approved["status"] == "APPROVED" and approved["approved_by"] == OWNER["sub"]
        voucher = db.query(StockAdjustmentVoucher).filter_by(count_id=cid).one()
        assert voucher.status == "POSTED" and voucher.effective_date == ist_today() and voucher.created_by == OPERATOR["sub"]
        db.expire_all()
        # Exact lots: the missing reel is written off by its own id; the oldest reel elsewhere also by its id.
        assert db.get(PaperReel, missing.id).current_weight_kg == 0 and db.get(PaperReel, missing.id).status == ReelStatus.CONSUMED
        assert db.get(PaperReel, oldest.id).current_weight_kg == 0
        assert db.get(PaperReel, found.id).current_weight_kg == 500
        # Wrong place moved to where it was found, and stays on QC hold.
        assert db.get(PaperReel, unfiled.id).location_id == rack_a.id
        moved = db.get(PaperReel, wrong.id)
        assert moved.location_id == rack_a.id and moved.stock_status == "QC_HOLD" and moved.current_weight_kg == 300
        # A short lot is reduced on that lot; loose stock becomes a new lot ON QC HOLD.
        balance = lambda batch_id: round(sum(t.qty_change for t in db.query(StockTransaction).filter_by(batch_id=batch_id).all()), 3)
        assert balance(drum.id) == 90
        loose = db.query(StockCountEntry).filter_by(count_id=cid, entity_type="LOOSE").one()
        new_batch = db.get(StockBatch, loose.created_batch_id)
        assert new_batch.stock_status == "QC_HOLD" and new_batch.location_id == rack_a.id and balance(new_batch.id) == 5
        # Issued but found: the issue stays; a new reel on QC hold is added.
        assert db.get(PaperReel, issued.id).status == ReelStatus.CONSUMED
        added = db.get(PaperReel, db.get(StockCountEntry, flagged_id).created_reel_id)
        assert added.stock_status == "QC_HOLD" and added.current_weight_kg == 450 and added.id != issued.id
        # Idempotent: approving again posts nothing more.
        approve_count(NotePayload(), cid, db, plant, OWNER)
        assert db.query(StockAdjustmentVoucher).filter_by(count_id=cid).count() == 1
        # The stock book shows it as count difference in corrections, and still balances.
        month = ist_today().strftime("%Y-%m")
        figures = month_figures(month, db, plant, OWNER)
        paper_row = _row(figures, paper)
        assert paper_row["count_variance"] == -650 + 450 and paper_row["identity_ok"]
        assert _row(figures, glue)["count_variance"] == -5 and _row(figures, glue)["identity_ok"]
        sources = month_figure_sources(paper.id, month, db, plant, OWNER)
        assert any(row["kind"] == "COUNT_VARIANCE" and row.get("lot") == missing.reel_code for row in sources["rows"])


def test_send_back_cancel_and_month_end_certificate():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        rack = _rack(db, plant, "RM-C-01")
        reel = _reel(db, plant, paper, 600, at=rack, inward=date(2026, 9, 5))
        other = _reel(db, plant, paper, 200, at=rack, inward=date(2026, 9, 6))
        db.commit()
        _refused(lambda: start_count(CountCreate(kind="MONTH_END"), db, plant, STORE), 422, "Choose the month")
        _refused(lambda: start_count(CountCreate(kind="MONTH_END", month="2099-01"), db, plant, STORE), 422, "has not started")
        count = start_count(CountCreate(kind="MONTH_END", month="2026-09"), db, plant, STORE)
        assert count["kind"] == "MONTH_END" and count["existing"] is False
        again = start_count(CountCreate(kind="MONTH_END", month="2026-09"), db, plant, OPERATOR)
        assert again["id"] == count["id"] and again["existing"] is True
        cid = uuid.UUID(count["id"])
        key = str(rack.id)
        scan_in_count(ScanPayload(rack=key, code=reel.reel_code, counted_qty=590, client_ref="me-1"), cid, db, plant, STORE)
        finish_rack(cid, key, db, plant, STORE)
        finish_rack(cid, "unassigned", db, plant, STORE)
        submit_count(NotePayload(), cid, db, plant, STORE)
        # Owner sends rack C back for a recount: the not-found line is taken back, the scan stays.
        back = send_back_count(SendBackPayload(note="Recount rack C", racks=[key]), cid, db, plant, OWNER)
        assert back["status"] == "DRAFT" and next(r for r in back["racks"] if r["key"] == key)["status"] == "RECOUNT"
        assert {entry["status"] for entry in back["entries"]} == {"FOUND"}
        rack_view = get_rack(cid, key, db, plant, STORE)
        assert rack_view["rack"]["recount_note"] == "Recount rack C" and any(row["id"] == str(other.id) for row in rack_view["expected"])
        scan_in_count(ScanPayload(rack=key, code=other.reel_code, client_ref="me-2"), cid, db, plant, STORE)
        finish_rack(cid, key, db, plant, STORE)
        submit_count(NotePayload(), cid, db, plant, STORE)
        approved = approve_count(NotePayload(), cid, db, plant, OWNER)
        assert approved["status"] == "CERTIFIED"
        header = db.get(InventoryCertification, cid)
        assert header.certified_by == OWNER["sub"] and header.counted_by == STORE["sub"]
        voucher = db.query(StockAdjustmentVoucher).filter_by(count_id=cid).one()
        # Dated on the month's last day so September's closing includes it.
        assert voucher.effective_date == date(2026, 9, 30)
        line = db.query(InventoryCertificationLine).filter_by(certification_id=cid, item_id=paper.id).one()
        assert (line.closing_qty, line.physical_qty, line.variance_qty) == (800, 790, -10)
        september = month_figures("2026-09", db, plant, OWNER)
        assert september["month_end_count"]["status"] == "CERTIFIED" and september["month_end_count"]["approved_by"] == OWNER["sub"]
        assert _row(september, paper)["closing"] == 790 and _row(september, paper)["count_variance"] == -10
        assert _row(month_figures("2026-10", db, plant, OWNER), paper)["opening"] == 790

        # A month that is closed cannot get a count; cancelling: creator while counting, else the Owner.
        lock_books_month(BooksLockPayload(month="2026-08"), db, plant, OWNER)
        _refused(lambda: start_count(CountCreate(kind="MONTH_END", month="2026-08"), db, plant, STORE), 409, "August 2026 is closed")
        spot = start_count(CountCreate(kind="SPOT", location_ids=[rack.id]), db, plant, STORE)
        from src.routers.stock_count import cancel_count
        _refused(lambda: cancel_count(NotePayload(), uuid.UUID(spot["id"]), db, plant, OPERATOR), 403)
        assert cancel_count(NotePayload(note="Started by mistake"), uuid.UUID(spot["id"]), db, plant, STORE)["status"] == "CANCELLED"
        joined = start_count(CountCreate(kind="SPOT", location_ids=[rack.id]), db, plant, OPERATOR)
        assert start_count(CountCreate(kind="SPOT", location_ids=[rack.id], join_open=True), db, plant, STORE)["id"] == joined["id"]


def test_corrections_wait_for_the_owner_and_post_exact_lots():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "RM-D-01")
        reel = _reel(db, plant, paper, 500, at=rack)
        older = _reel(db, plant, paper, 500, at=rack, inward=date(2026, 9, 1))
        drum = _lot(db, plant, glue, 60, at=rack, status="QC_HOLD")
        db.commit()
        _refused(lambda: raise_correction(CorrectionPayload(code=reel.reel_code, new_qty=480, reason="OTHER"), db, plant, STORE), 422, "Write what happened")
        draft = raise_correction(CorrectionPayload(code=reel.reel_code, new_qty=480, reason="WRONG_GRN_WEIGHT"), db, plant, STORE)
        assert draft["status"] == "DRAFT" and draft["lines"][0]["qty_delta"] == -20 and draft["lines"][0]["lot_code"] == reel.reel_code
        db.expire_all()
        assert db.get(PaperReel, reel.id).current_weight_kg == 500  # nothing changes until the Owner approves
        posted = approve_correction(uuid.UUID(draft["id"]), CorrectionDecisionPayload(), db, plant, OWNER)
        assert posted["status"] == "POSTED" and posted["approved_by"] == OWNER["sub"]
        db.expire_all()
        assert db.get(PaperReel, reel.id).current_weight_kg == 480 and db.get(PaperReel, older.id).current_weight_kg == 500
        gone = raise_correction(CorrectionPayload(code=drum.batch_no, not_here=True, reason="DAMAGED_IN_STORE"), db, plant, PLANT_HEAD)
        _refused(lambda: reject_correction(uuid.UUID(gone["id"]), CorrectionDecisionPayload(note=""), db, plant, OWNER), 422)
        rejected = reject_correction(uuid.UUID(gone["id"]), CorrectionDecisionPayload(note="Drum is in the QC bay"), db, plant, OWNER)
        assert rejected["status"] == "CANCELLED" and rejected["cancel_note"] == "Drum is in the QC bay"
        found = raise_correction(CorrectionPayload(item_id=glue.id, new_qty=12, reason="LABEL_LOST_FOUND", location_id=rack.id), db, plant, STORE)
        approve_correction(uuid.UUID(found["id"]), CorrectionDecisionPayload(), db, plant, OWNER)
        created = db.query(StockBatch).filter(StockBatch.item_id == glue.id, StockBatch.id != drum.id).one()
        assert created.stock_status == "QC_HOLD" and created.location_id == rack.id
        listing = list_corrections("ALL", db, plant, STORE)
        assert listing["waiting_count"] == 0 and {row["kind"] for row in listing["items"]} == {"CORRECTION"}
        _floor_issue(db, plant, older, date(2026, 10, 3), section="WINDER_SECTION")
        db.commit()
        _refused(lambda: raise_correction(CorrectionPayload(code=older.reel_code, new_qty=500, reason="COUNT_EXTRA"), db, plant, STORE), 409, "Nothing comes back from the floor")


def test_locations_moves_put_away_and_guards():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "RM-E-01")
        floor = _rack(db, plant, "WIP-E-01", purpose="WIP")
        reel = _reel(db, plant, paper, 500, status="QC_HOLD")
        lot = _lot(db, plant, glue, 40)
        used = _reel(db, plant, paper, 300, at=rack)
        _floor_issue(db, plant, used, date(2026, 10, 3), section="WINDER_SECTION")
        db.commit()
        overview = locations_overview(True, db, plant, STORE)
        assert overview["unassigned"]["reels"] == 1 and overview["unassigned"]["lots"] == 1

        moved = scan_move(ScanMovePayload(to_location_id=rack.id, code=reel.reel_code, client_ref="mv-0001"), db, plant, STORE)
        assert moved["moved"] and moved["from"] is None and moved["to"]["code"] == "RM-E-01" and moved["held"] is True
        assert scan_move(ScanMovePayload(to_location_id=rack.id, code=reel.reel_code, client_ref="mv-0001"), db, plant, STORE)["message"] == "Already moved."
        event = [e for e in db.query(ReelScanEvent).filter_by(reel_id=reel.id).all() if (e.event_metadata or {}).get("source") == "SCAN_MOVE"][0]
        assert event.event_metadata["actor"] == STORE["sub"] and event.event_metadata["to_location_code"] == "RM-E-01"
        db.expire_all()
        assert db.get(PaperReel, reel.id).stock_status == "QC_HOLD"
        undo_scan_move(ScanMoveUndoPayload(client_ref="mv-0001"), db, plant, STORE)
        db.expire_all()
        assert db.get(PaperReel, reel.id).location_id is None
        _refused(lambda: scan_move(ScanMovePayload(to_location_id=rack.id, code=used.reel_code, client_ref="mv-0002"), db, plant, STORE), 409, "Nothing comes back from the floor")
        _refused(lambda: scan_move(ScanMovePayload(to_location_id=floor.id, code=reel.reel_code, client_ref="mv-0003"), db, plant, STORE), 409, "production floor")
        _refused(lambda: create_stock_move(StockMoveCreate(entity_type="REEL", entity_id=used.id, to_location_id=rack.id), db, plant, STORE), 409)

        detail = get_location(rack.id, db, plant, OPERATOR)
        assert detail["stock"]["reels"] == [] and detail["location"]["code"] == "RM-E-01"
        result = put_away_all_unassigned(PutAwayAllPayload(), db, plant, OWNER)
        assert result["moved"] == 2 and result["to"]["code"] == "RM-STORE"
        db.expire_all()
        store_id = uuid.UUID(result["to"]["id"])
        assert db.get(PaperReel, reel.id).location_id == store_id and db.get(StockBatch, lot.id).location_id == store_id
        _refused(lambda: update_location(store_id, LocationUpdate(active=False), db, plant, STORE), 409, "RM store")
        rack_detail = update_location(rack.id, LocationUpdate(name="Paper rack E1", bin="E1"), db, plant, PLANT_HEAD)
        assert rack_detail["name"] == "Paper rack E1" and rack_detail["updated_by"] == PLANT_HEAD["sub"]
        scan_move(ScanMovePayload(to_location_id=rack.id, code=lot.batch_no, client_ref="mv-0004"), db, plant, STORE)
        _refused(lambda: update_location(rack.id, LocationUpdate(active=False), db, plant, STORE), 409, "still holds")
        update_location(rack.id, LocationUpdate(is_receiving_default=True), db, plant, STORE)
        db.expire_all()
        assert db.get(InventoryLocation, rack.id).is_receiving_default and not db.get(InventoryLocation, store_id).is_receiving_default


def test_moves_during_and_after_the_count_are_never_a_loss_and_issued_found_needs_a_decision():
    """Final round 2026-10-30: a reel marked not found at Rack done and moved elsewhere later posts nothing,
    so the review counts it as moved (0 in loss / net / value / Not found); a lot moved off the rack before
    Rack done gets its own "moved away during the count" line; approval refuses while an issued-but-found
    line is undecided (the Owner chooses, approval never picks)."""
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        rack_a, rack_b = _rack(db, plant, "MV-A-01"), _rack(db, plant, "MV-B-01")
        kept = _reel(db, plant, paper, 226, at=rack_a)
        later = _reel(db, plant, paper, 210.5, at=rack_a)
        away = _reel(db, plant, paper, 300, at=rack_a)
        issued = _reel(db, plant, paper, 640, at=rack_a)
        _floor_issue(db, plant, issued, date(2026, 10, 20), section="WINDER_SECTION", created=datetime.utcnow() - timedelta(days=3))
        db.commit()
        count = start_count(CountCreate(kind="SPOT", location_ids=[rack_a.id]), db, plant, OPERATOR)
        cid = uuid.UUID(count["id"])
        a = str(rack_a.id)
        from src.routers.stock_count import start_rack
        start_rack(cid, a, db, plant, OPERATOR)
        scan_in_count(ScanPayload(rack=a, code=kept.reel_code, counted_qty=224, client_ref="mv-kept"), cid, db, plant, OPERATOR)
        flagged = scan_in_count(ScanPayload(rack=a, code=issued.reel_code, client_ref="mv-issued"), cid, db, plant, OPERATOR)
        assert flagged["entry"]["status"] == "ISSUED_FOUND"
        # Moved off the rack while it was being counted, before Rack done.
        scan_move(ScanMovePayload(to_location_id=rack_b.id, code=away.reel_code, client_ref="mv-away-1"), db, plant, STORE)
        done = finish_rack(cid, a, db, plant, OPERATOR)
        assert done["marked_missing"] == 1  # only `later`; `away` is not missing
        # Marked not found, then moved to another rack: it was plainly in store.
        scan_move(ScanMovePayload(to_location_id=rack_b.id, code=later.reel_code, client_ref="mv-later-1"), db, plant, STORE)
        submit_count(NotePayload(), cid, db, plant, OPERATOR)

        review = get_count(cid, db, plant, OWNER)
        by_code = {entry["code"]: entry for entry in review["entries"]}
        assert by_code[away.reel_code]["status"] == "MOVED" and by_code[away.reel_code]["movement_flag"] == "MOVED_DURING_COUNT"
        assert "MV-B-01" in by_code[away.reel_code]["note"] and by_code[away.reel_code]["variance_qty"] == 0
        moved_later = by_code[later.reel_code]
        assert moved_later["status"] == "MOVED" and moved_later["variance_qty"] == 0 and moved_later["value"] == 0
        summary = review["summary"]
        assert summary["missing"] == 0 and summary["moved"] == 2
        assert summary["loss_value"] == -80.0 and summary["by_unit"][0]["loss"] == -2.0  # only the 2 kg short on `kept`
        rack_view = next(rack for rack in review["racks"] if rack["label"] == "MV-A-01")
        assert rack_view["progress"]["missing"] == 0 and rack_view["progress"]["moved"] == 2

        refused = _refused(lambda: approve_count(NotePayload(), cid, db, plant, OWNER), 409, "Decide the 1 issued-but-found line first")
        assert refused.detail["code"] == "COUNT_UNDECIDED"
        db.rollback()
        decide_issued_found(DecisionPayload(decision="LEAVE_AS_USED"), cid, uuid.UUID(flagged["entry"]["id"]), db, plant, OWNER)
        approved = approve_count(NotePayload(), cid, db, plant, OWNER)
        assert approved["status"] == "APPROVED"
        voucher = db.query(StockAdjustmentVoucher).filter_by(count_id=cid).one()
        assert len(voucher.lines) == 1 and voucher.lines[0].qty_delta == -2
        db.expire_all()
        assert db.get(PaperReel, later.id).current_weight_kg == 210.5 and db.get(PaperReel, later.id).location_id == rack_b.id
        after = get_count(cid, db, plant, OWNER)
        assert after["summary"]["missing"] == 0 and after["summary"]["loss_value"] == -80.0
        from src.routers.stock_count import _list_progress
        assert _list_progress(db, [db.get(InventoryCertification, cid)])[str(cid)][1]["MISSING"] == 0
