"""The plant's AIT reel serial on live PostgreSQL (owner decision 6, 1 Nov 2026).

One running series of reels per plant and financial year (AIT 00001 again on 1 April), the Owner / Admin sets
the next number of the current year once (audited, afterwards only raised), numbers are never given twice even
when receipts post at the same moment, and a received reel prints the plant's label lines.
"""
import os
import threading
import uuid
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema
from src.database import Base, SessionLocal, engine
from src.models import ItemMaster, LotLabelRecord, PaperReel, PurchaseOrderRevision, ReelSerialSetting
from src.routers.labels import find_label_by_number
from src.routers.manual_receipts import ManualReceiptCreate, post_manual_receipt
from src.routers.procurement import GovernedReceiptCreate, get_governed_receipt, post_governed_receipt
from src.routers.purchase import PurchaseOrderCreate, RevisionActionPayload, approve_purchase_order, create_purchase_order, submit_purchase_order
from src.routers.quality import QualityInspectionCreate, create_quality_inspection
from src.routers.reel_serial import ReelSerialSet, get_reel_serial, set_reel_serial
from src.services import reel_serial

MAKER = {"sub": "store.maker@example.com", "roles": ["Store"], "token": ""}
OWNER = {"sub": "plant.owner@example.com", "roles": ["Owner"], "token": ""}
QC = {"sub": "qc-inspector", "roles": ["QC"], "token": ""}


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()


def _plant() -> str:
    return str(uuid.uuid4())


def _paper(db, plant, code=None):
    item = ItemMaster(item_code=code or f"351-{uuid.uuid4().hex[:6]}", name="Kraft 350 GSM", type="RAW_PAPER",
                      tracking_mode="REEL", uom="KG", plant_id=plant, active="true", qc_nominals={"gsm": 350, "ply_bond": 400},
                      quality_profile={"status": "approved", "revision": 1, "parameters": [{"code": "gsm", "min": 300, "max": 400}]})
    db.add(item)
    db.commit()
    return item


def _approved_po(db, plant, item):
    with patch("src.routers.purchase.emit_audit_event"):
        created = create_purchase_order(PurchaseOrderCreate(
            request_id=uuid.uuid4(), category="RM_PM", supplier_id=uuid.uuid4(), supplier_name="Akshat Paper Mills Pvt Ltd",
            expected_date=date(2026, 10, 28), lines=[{"item_id": item.id, "qty_ordered": 10000, "unit_cost": 30, "uom": "KG"}],
        ), db, plant, MAKER)
        revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created["id"]).one()
        submitted = submit_purchase_order(created["id"], RevisionActionPayload(expected_version=created["version"], content_hash=revision.content_hash, reason="Ready"), db, plant, MAKER)
        return approve_purchase_order(created["id"], RevisionActionPayload(expected_version=submitted["version"], content_hash=revision.content_hash, reason="Approved"), db, plant, OWNER)


def _receive(db, plant, po, rolls, *, on=date(2026, 10, 28), invoice="2525", mill="akshat"):
    return post_governed_receipt(GovernedReceiptCreate(
        request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=on, supplier_challan_no=f"CH-{uuid.uuid4().hex[:6]}",
        invoice_no=invoice, invoice_date=on, mill_name=mill,
        lines=[{"po_line_id": uuid.UUID(po["lines"][0]["id"]), "invoice_rate": 30,
                "lots": [{"source_reel_no": roll, "net_weight_kg": 1161, "width_mm": 1000, "physical_form": "REEL"} for roll in rolls]}],
    ), db, plant, MAKER)


def _set(db, plant, number, reason="Plant series as on go-live", code="RN-PLANT-SERIES"):
    with patch("src.routers.reel_serial.emit_audit_event"), patch("src.routers.reel_serial.ist_today", return_value=date(2026, 11, 1)):
        return set_reel_serial(ReelSerialSet(next_number=number, reason_code=code, reason_note=reason), db, plant, OWNER)


def test_owner_sets_the_next_number_once_then_receipts_count_on_from_it():
    db = SessionLocal()
    plant = _plant()
    try:
        item = _paper(db, plant, code="351")
        with patch("src.routers.reel_serial.ist_today", return_value=date(2026, 11, 1)):
            fresh = get_reel_serial(db, plant, MAKER)
        assert fresh["next_serial"] == "AIT 00001" and fresh["year_label"] == "2026-27" and not fresh["can_set"]
        state = _set(db, plant, 6280)
        assert state["next_serial"] == "AIT 06280" and state["history"][0]["to_number"] == 6280
        assert state["history"][0]["set_by"] == OWNER["sub"]

        po = _approved_po(db, plant, item)
        receipt = _receive(db, plant, po, ["65686", "65687"])
        serials = [lot["at_no"] for lot in receipt["created_lots"]]
        assert serials == ["AIT 06280", "AIT 06281"]
        reel = db.get(PaperReel, uuid.UUID(receipt["created_lots"][0]["id"]))
        assert reel.reel_code == "AIT 06280"
        assert reel.inward_metadata["serial_no"] == 6280 and reel.inward_metadata["serial_fy"] == 2026
        assert reel.inward_metadata["mill_name"] == "AKSHAT"
        assert db.query(LotLabelRecord).filter_by(reel_id=reel.id).one().content_snapshot["amigo_no"] == "AIT 06280"

        # The plant label's lines, worked out at print time.
        facts = receipt["created_lots"][0]["label"]["facts"]
        assert facts == {**facts, "serial": "AIT 06280", "mill": "AKSHAT", "invoice_no": "2525", "received_date": "28-Oct-26",
                         "plybond": "400", "variety": "351", "gsm": "351", "roll_no": "65686", "weight_kg": "1161", "form": "REEL"}
        # Incoming QC measured GSM: the label prints the measured average instead of the variety.
        with patch("src.routers.quality.emit_audit_event", create=True):
            create_quality_inspection(QualityInspectionCreate(entity_type="REEL", entity_id=reel.id,
                                                              readings={"gsm": 353, "ply_bond": 410}), db, plant, QC)
        db.expire_all()
        lot = next(row for row in get_governed_receipt(uuid.UUID(receipt["id"]), db, plant, MAKER)["lots"] if row["id"] == str(reel.id))
        assert lot["label"]["facts"]["gsm"] == "353" and lot["label"]["facts"]["plybond"] == "410"

        # After serials are on reels the number can only go up, never down; each change is kept.
        with pytest.raises(HTTPException) as lower:
            _set(db, plant, 6000)
        assert lower.value.status_code == 409 and "never lowered" in lower.value.detail
        raised = _set(db, plant, 6300, reason="Skipped a printed book", code="RN-SPOILED")
        assert raised["history"][0]["reason_code"] == "RN-SPOILED"
        assert raised["history"][0]["reason"] == "Rn spoiled — Skipped a printed book"
        assert raised["next_serial"] == "AIT 06300" and raised["last_serial"] == "AIT 06281" and len(raised["history"]) == 2
        assert db.query(ReelSerialSetting).filter_by(plant_id=plant).count() == 2

        # Typed any way, the serial finds its reel (issue desks, search).
        scope = {"scope_all": False, "selected_plant_id": plant, "allowed_plants": [plant]}
        found = find_label_by_number(code="ait 6280", kind="ALL", limit=12, db=db, plant_scope=scope, current_user=MAKER)
        assert found["match"] == "EXACT" and [row["code"] for row in found["rows"]] == ["AIT 06280"]
    finally:
        db.rollback()
        db.close()


def test_only_the_owner_or_admin_sets_it():
    from src.utils.auth import require_role

    with pytest.raises(HTTPException) as refused:
        require_role([])(MAKER)
    assert refused.value.status_code == 403


def test_series_restarts_on_1_april_and_a_reused_number_keeps_a_unique_reel_code():
    db = SessionLocal()
    plant = _plant()
    try:
        item = _paper(db, plant)
        po = _approved_po(db, plant, item)
        march = _receive(db, plant, po, ["M-1"], on=date(2027, 3, 31), invoice="M-77")
        april = _receive(db, plant, po, ["A-1"], on=date(2027, 4, 1), invoice="A-12")
        assert march["created_lots"][0]["at_no"] == "AIT 00001" and april["created_lots"][0]["at_no"] == "AIT 00001"
        codes = {db.get(PaperReel, uuid.UUID(row["created_lots"][0]["id"])).reel_code for row in (march, april)}
        assert codes == {"AIT 00001", "AIT 00001/27-28"}
        # A manual receipt shares the series.
        manual = post_manual_receipt(ManualReceiptCreate(
            request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Vatsalya Paper", reason_code="MR-URGENT", reason_note="No PO yet",
            received_date=date(2027, 4, 2), supplier_challan_no="VPI/1686/2027-28", invoice_pending=True, mill_name="Vatsalya",
            lines=[{"item_id": item.id, "lots": [{"source_reel_no": "57699", "net_weight_kg": 663, "width_mm": 1000, "physical_form": "REEL"}]}],
        ), db, plant, MAKER)
        reel = db.get(PaperReel, uuid.UUID(manual["lots"][0]["id"]))
        assert reel.inward_metadata["amigo_no"] == "AIT 00002" and reel.inward_metadata["mill_name"] == "VATSALYA"
    finally:
        db.rollback()
        db.close()


def test_receipts_posting_at_the_same_moment_never_share_a_number():
    plant = _plant()
    taken: list[str] = []
    errors: list[Exception] = []
    start = threading.Barrier(8)

    def take() -> None:
        session = SessionLocal()
        try:
            start.wait(timeout=10)
            taken.append(reel_serial.next_reel_serial(session, plant, date(2026, 11, 1))["serial"])
            session.commit()
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)
            session.rollback()
        finally:
            session.close()

    threads = [threading.Thread(target=take) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert not errors
    assert sorted(taken) == [reel_serial.serial_text(number) for number in range(1, 9)]
