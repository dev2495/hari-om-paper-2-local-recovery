"""Issue to the floor end to end (client 2026-10-30), live PostgreSQL.

No shift is asked: the server registers the issue now and takes the shift and business date from that moment
(A 08:00-20:00, B 20:00-08:00 IST, business date = the day the shift began). Only QC-cleared stock goes; a
double scan / double submit issues once; closed months refuse; the issue history lists every issue with its
shift, person and rack; the stock book counts it as Issued on the same business day. Reel / coil labels carry
readable lines (QC averages, else "(spec)", blanks stay blank) with the QR unchanged.
"""
import os
import uuid
from datetime import date, datetime
from unittest.mock import patch

import pytest

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.database import SessionLocal
from src.models import InventoryQualityInspection, PaperReel, ReelIssue, StockTransaction, TransactionType
from src.routers.books import BooksLockPayload, lock_books_month
from src.routers.issue import IssueCreate, create_issue
from src.routers.issue_history import issue_history
from src.routers.labels import get_reel_label
from src.routers.reel_issues import ReelIssueCreate, WeightIssueCreate, create_reel_issue, issue_parchment_by_weight
from src.routers.stock_control import month_figure_sources, month_figures
from src.services.labels import reel_label_facts
from src.services.procurement_documents import build_lot_label_pdf
from src.services.shift_rule import shift_at

from test_stock_count_flow_postgres import OWNER, STORE, _item, _lot, _rack, _reel, _refused, _row, setup_module  # noqa: F401

# 01:30 IST on 31 Oct 2026 = 20:00 UTC on 30 Oct: Shift B of 30 Oct.
AFTER_MIDNIGHT = datetime(2026, 10, 30, 20, 0)


def _at(moment: datetime):
    """Freeze the registration clock (naive UTC)."""
    return patch("src.services.shift_rule._utc_now", return_value=moment)


def _scope(plant):
    return {"scope_all": False, "selected_plant_id": plant, "allowed_plants": [plant]}


def _history(db, plant, **filters):
    base = {"date_from": None, "date_to": None, "shift": None, "item_id": None, "item": None, "card": None, "person": None, "kind": "ALL"}
    return issue_history(**{**base, **filters}, db=db, plant_scope=_scope(plant), current_user=STORE)


def test_the_shift_rule_in_ist():
    assert (shift_at(AFTER_MIDNIGHT).shift, shift_at(AFTER_MIDNIGHT).business_date) == ("B", date(2026, 10, 30))
    assert shift_at(AFTER_MIDNIGHT).label == "Shift B · 30 Oct"
    assert shift_at(datetime(2026, 10, 31, 2, 29)).label == "Shift B · 30 Oct"   # 07:59 IST
    assert shift_at(datetime(2026, 10, 31, 2, 30)).label == "Shift A · 31 Oct"   # 08:00 IST
    assert shift_at(datetime(2026, 10, 30, 14, 29)).shift == "A"                # 19:59 IST
    assert shift_at(datetime(2026, 10, 30, 14, 30)).label == "Shift B · 30 Oct"  # 20:00 IST
    assert shift_at(datetime(2026, 10, 31, 20, 30)).business_date == date(2026, 10, 31)  # 02:00 IST on 1 Nov


def test_reel_issue_after_midnight_is_shift_b_of_the_day_before_once_and_in_history_and_book():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        rack = _rack(db, plant, "R9-A-01")
        coil = _reel(db, plant, paper, 400, at=rack)
        coil.physical_form = "COIL"
        held = _reel(db, plant, paper, 300, at=rack, status="QC_HOLD")
        rejected = _reel(db, plant, paper, 200, at=rack, status="BLOCKED")
        db.commit()
        key = uuid.uuid4()
        with _at(AFTER_MIDNIGHT), patch("src.routers.reel_issues.emit_audit_event"):
            # The desk sends no shift or date; an old screen's "GENERAL" / other date is ignored.
            first = create_reel_issue(ReelIssueCreate(reel_id=coil.id, request_id=key, shift="GENERAL", issue_date=date(2026, 10, 1)), db, plant, STORE)
            again = create_reel_issue(ReelIssueCreate(reel_id=coil.id, request_id=key), db, plant, STORE)
            twice = _refused(lambda: create_reel_issue(ReelIssueCreate(reel_id=coil.id), db, plant, STORE), 400)
            db.rollback()
            hold = _refused(lambda: create_reel_issue(ReelIssueCreate(reel_id=held.id), db, plant, STORE), 400)
            db.rollback()
            reject = _refused(lambda: create_reel_issue(ReelIssueCreate(reel_id=rejected.id), db, plant, STORE), 400)
            db.rollback()
        assert (first.shift, first.issue_date, first.shift_label) == ("B", date(2026, 10, 30), "Shift B · 30 Oct")
        assert first.issued_at == AFTER_MIDNIGHT and first.issued_by == STORE["sub"] and first.from_location_id == rack.id
        assert again.idempotent and again.id == first.id
        assert db.query(ReelIssue).filter(ReelIssue.reel_id == coil.id).count() == 1
        assert "already issued to the floor (Shift B · 30 Oct)" in twice.detail
        assert "waiting for incoming QC" in hold.detail and "rejected by incoming QC" in reject.detail

        history = _history(db, plant, date_from=date(2026, 10, 30), date_to=date(2026, 10, 30))
        row = next(row for row in history["rows"] if row["lot"] == coil.reel_code)
        assert (row["shift"], row["day"], row["shift_label"], row["qty"], row["uom"]) == ("B", "2026-10-30", "Shift B · 30 Oct", 400.0, "KG")
        assert row["to"] == "Floor · winders" and row["issued_by"] == STORE["sub"] and row["from_location"]["code"] == "R9-A-01"
        assert history["people"] == [STORE["sub"]]
        assert _history(db, plant, date_from=date(2026, 10, 30), date_to=date(2026, 10, 30), shift="A")["count"] == 0
        assert _history(db, plant, date_from=date(2026, 10, 31), date_to=date(2026, 10, 31))["count"] == 0
        assert _history(db, plant, date_from=date(2026, 10, 30), date_to=date(2026, 10, 30), person="nobody")["count"] == 0
        assert _history(db, plant, date_from=date(2026, 10, 30), date_to=date(2026, 10, 30), item=coil.reel_code.lower())["count"] == 1

        # Stock book: Issued on 30 Oct, the shift's business day (not 31 Oct, the calendar day in India).
        book = _row(month_figures("2026-10", db, plant, OWNER), paper)
        assert book["issued"] == 400.0
        sources = month_figure_sources(paper.id, "2026-10", db, plant, OWNER)
        issued = [source for source in sources["rows"] if source["kind"] == "ISSUED"]
        assert [(source["day"], source["qty"], source.get("shift")) for source in issued] == [("2026-10-30", -400.0, "B")]


def test_an_issue_at_0130_on_1_nov_stays_in_october_and_a_closed_month_refuses():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        reel = _reel(db, plant, paper, 250)
        late = _reel(db, plant, paper, 150)
        db.commit()
        with _at(datetime(2026, 10, 31, 20, 0)), patch("src.routers.reel_issues.emit_audit_event"):  # 01:30 IST on 1 Nov
            issued = create_reel_issue(ReelIssueCreate(reel_id=reel.id), db, plant, STORE)
        assert (issued.shift, issued.issue_date) == ("B", date(2026, 10, 31))
        assert _row(month_figures("2026-10", db, plant, OWNER), paper)["issued"] == 250.0
        # September is closed: 01:30 IST on 1 Oct is Shift B of 30 Sep, so it is refused in plain words.
        lock_books_month(BooksLockPayload(month="2026-09"), db, plant, OWNER)
        with _at(datetime(2026, 9, 30, 20, 0)), patch("src.routers.reel_issues.emit_audit_event"):
            refused = _refused(lambda: create_reel_issue(ReelIssueCreate(reel_id=late.id), db, plant, STORE), 409)
        assert refused.detail["message"] == "September 2026 is closed. Ask the owner to re-open it."
        db.rollback()
        assert float(db.get(PaperReel, late.id).current_weight_kg) == 150


def test_material_issue_derives_shift_issues_once_and_refuses_held_lots():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, "ADHESIVE", tracking="BULK")
        rack = _rack(db, plant, "R9-G-01")
        _lot(db, plant, glue, 60, at=rack)
        held = _lot(db, plant, glue, 40, at=rack, status="QC_HOLD")
        db.commit()
        ref = f"FLOOR:{uuid.uuid4()}"
        with _at(AFTER_MIDNIGHT), patch("src.routers.issue.emit_audit_event"):
            # An old screen's shift A / date are ignored for a floor issue: the clock says Shift B of 30 Oct.
            first = create_issue(IssueCreate(item_id=glue.id, qty=25, shift="A", effective_date=date(2026, 10, 2), external_ref=ref), db, plant, STORE)
            again = create_issue(IssueCreate(item_id=glue.id, qty=25, external_ref=ref), db, plant, STORE)
            hold = _refused(lambda: create_issue(IssueCreate(item_id=glue.id, batch_id=held.id, qty=5), db, plant, STORE), 400)
            db.rollback()
        assert (first.shift, first.effective_date, first.shift_label, first.idempotent) == ("B", date(2026, 10, 30), "Shift B · 30 Oct", False)
        assert again.idempotent and again.transaction_id == first.transaction_id and "Nothing was issued twice" in again.message
        rows = db.query(StockTransaction).filter(StockTransaction.item_id == glue.id, StockTransaction.transaction_type == TransactionType.ISSUE_PRODUCTION).all()
        assert [(-row.qty_change, row.effective_date, row.movement_metadata["shift"], row.movement_metadata["issued_by"]) for row in rows] == [(25, date(2026, 10, 30), "B", STORE["sub"])]
        assert "has not passed incoming QC" in hold.detail
        assert again.item_balance == 75  # 60 - 25 cleared + 40 on hold: issued once

        history = _history(db, plant, date_from=date(2026, 10, 24), date_to=date(2026, 10, 30), kind="MATERIAL")
        row = history["rows"][0]
        assert (history["count"], row["shift"], row["qty"], row["to"], row["from_location"]["code"]) == (1, "B", 25.0, "Floor", "R9-G-01")
        assert history["totals"] == [{"uom": "KG", "unit": "kg", "qty": 25.0, "count": 1}]
        assert _row(month_figures("2026-10", db, plant, OWNER), glue)["issued"] == 25.0


def test_parchment_by_weight_same_key_issues_once():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        red = _item(db, plant, "PARCHMENT")
        _reel(db, plant, red, 30)
        _reel(db, plant, red, 50)
        db.commit()
        key = uuid.uuid4()
        with _at(AFTER_MIDNIGHT), patch("src.routers.reel_issues.emit_audit_event"):
            first = issue_parchment_by_weight(WeightIssueCreate(item_id=red.id, qty_kg=40, request_id=key), db, plant, STORE)
            again = issue_parchment_by_weight(WeightIssueCreate(item_id=red.id, qty_kg=40, request_id=key), db, plant, STORE)
        assert (first["shift"], first["issue_date"], first["issued_kg"]) == ("B", "2026-10-30", 40)
        assert again["idempotent"] and again["issued_kg"] == 40 and again["available_after_kg"] == 40
        assert db.query(ReelIssue).filter(ReelIssue.request_id == key).count() == 2  # two coils, once
        history = _history(db, plant, date_from=date(2026, 10, 30), date_to=date(2026, 10, 30))
        assert history["count"] == 2 and {row["kind"] for row in history["rows"]} == {"MATERIAL"}


def test_reel_label_lines_come_from_qc_averages_else_spec_and_blanks_stay_blank():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant)
        paper.qc_nominals = {"gsm": 230, "bf": 18}
        reel = _reel(db, plant, paper, 1000)
        reel.width_mm, reel.source_reel_no, reel.supplier_name_snapshot = 1020, "C-100", "Shree Mills"
        reel.inward_metadata = {"amigo_no": reel.reel_code}
        for gsm in (230, 233):
            db.add(InventoryQualityInspection(plant_id=plant, entity_type="REEL", entity_id=reel.id, material_type="RAW_PAPER",
                                              source="INWARD", status="PASS", readings={"gsm": gsm, "moisture_pct": 7}))
        db.add(InventoryQualityInspection(plant_id=plant, entity_type="REEL", entity_id=reel.id, material_type="RAW_PAPER",
                                          source="INWARD", status="INVALID", readings={"gsm": 999}))
        db.commit()
        result = reel_label_facts(db, reel, paper)
        facts, sources = result["facts"], result["fact_sources"]
        assert (facts["gsm"], sources["gsm"]) == ("231.5", "QC")          # average of the two samples
        assert (facts["bf"], sources["bf"]) == ("18 (spec)", "SPEC")      # no reading: the master value, marked
        assert (facts["ply_bond"], sources["ply_bond"]) == ("", None)     # nobody gave it: blank, never 0
        assert (facts["width_mm"], facts["weight_kg"], facts["reel_no"], facts["vendor"]) == ("1,020", "1,000", "C-100", "Shree Mills")
        assert facts["received_date"] == "02 Oct 2026" and facts["item"].startswith(paper.item_code)

        label = get_reel_label(reel.id, db, _scope(plant), STORE)
        assert label["qr_value"] == f"HARIOM|REEL|{plant}|{reel.id}|{reel.reel_code}"  # QR payload unchanged
        assert label["facts"]["gsm"] == "231.5"
        for profile in ("PAPER_LOT_4X2", "PAPER_LOT_A4"):
            assert build_lot_label_pdf([label], 1, profile).startswith(b"%PDF")
