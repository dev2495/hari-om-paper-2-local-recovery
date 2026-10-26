"""PO receipt → floor issue by shift → slitting card (client rule 2026-10-18).

A reel always goes whole to the slitter and gets a slitting card (coils made + wastage);
a coil goes whole straight to the winders. No machine is chosen, nothing comes back to
store, and the kg issued is what reconciliation counts as consumed.
"""
import os
import uuid
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.database import SessionLocal
from src.models import ItemMaster, LotLabelRecord, PaperReel, PurchaseOrderLine, PurchaseOrderRevision, ReelIssue, ReelScanEvent
from src.routers.procurement import GovernedReceiptCreate, post_governed_receipt
from src.routers.quality import QualityInspectionCreate, create_quality_inspection
from src.routers.purchase import PurchaseOrderCreate, RevisionActionPayload, approve_purchase_order, create_purchase_order, submit_purchase_order
from src.routers.ledger import aggregate_transactions_by_item
from src.routers.reel_issues import ReelIssueClosePayload, ReelIssueCreate, SlittingCardPayload, close_reel_issue, create_reel_issue, record_slitting_card

# Own plant: document series (PO, GRN, AT) stay independent of other suites.
PLANT = str(uuid.uuid4())
MAKER = {"sub": "store.maker@example.com", "roles": ["Store"], "token": ""}
CHECKER = {"sub": "plant.checker@example.com", "roles": ["Owner"], "token": ""}
QC = {"sub": "qc-inspector", "roles": ["QC"], "token": ""}
WINDER = uuid.uuid4()


def _paper(db):
    item = ItemMaster(item_code=f"PAPER-SLIT-{uuid.uuid4().hex[:8]}", name="Kraft 230 GSM", type="RAW_PAPER",
                      tracking_mode="REEL", uom="KG", plant_id=PLANT, active="true",
                      quality_profile={"status": "approved", "revision": 1, "parameters": [{"code": "gsm", "min": 200, "max": 260}]})
    db.add(item)
    db.commit()
    return item


def _approved_po(db, item, qty=3000):
    created = create_purchase_order(PurchaseOrderCreate(
        request_id=uuid.uuid4(), category="RM_PM", supplier_id=uuid.uuid4(), supplier_name="Slit test mill",
        expected_date=date(2026, 9, 25),
        lines=[{"item_id": item.id, "qty_ordered": qty, "unit_cost": 30, "uom": "KG", "expected_unit_count": 2,
                "count_basis": "ESTIMATED", "incoming_qc_required": False}],
    ), db, PLANT, MAKER)
    revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created["id"]).one()
    submitted = submit_purchase_order(created["id"], RevisionActionPayload(expected_version=created["version"], content_hash=revision.content_hash, reason="Ready"), db, PLANT, MAKER)
    return approve_purchase_order(created["id"], RevisionActionPayload(expected_version=submitted["version"], content_hash=revision.content_hash, reason="Approved"), db, PLANT, CHECKER)


def _receive(db, po, lots):
    return post_governed_receipt(GovernedReceiptCreate(supplier_challan_no=f"CH-{uuid.uuid4().hex[:8]}", 
        request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=date(2026, 9, 25),
        invoice_no=f"INV-{uuid.uuid4().hex[:6]}", invoice_date=date(2026, 9, 25),
        lines=[{"po_line_id": uuid.UUID(po["lines"][0]["id"]), "invoice_rate": 30, "lots": lots}],
    ), db, PLANT, MAKER)


def _pass_incoming_qc(db, *reel_ids):
    for reel_id in reel_ids:
        create_quality_inspection(QualityInspectionCreate(entity_type="REEL", entity_id=reel_id, readings={"gsm": 230},
                                                          disposition="ACCEPT"), db, PLANT, QC)


def _issue(db, reel_id, **kwargs):
    with patch("src.routers.reel_issues.emit_audit_event"):
        return create_reel_issue(ReelIssueCreate(reel_id=reel_id, shift="A", issue_date=date(2026, 9, 25), **kwargs), db, PLANT, MAKER)


def _close(db, issue_id, consumed):
    with patch("src.routers.reel_issues.emit_audit_event"):
        return close_reel_issue(issue_id, ReelIssueClosePayload(consumed_weight_kg=consumed), db, PLANT, MAKER)


def _card(db, issue_id, user=MAKER, **kwargs):
    with patch("src.routers.reel_issues.emit_audit_event"):
        return record_slitting_card(issue_id, SlittingCardPayload(**kwargs), db, PLANT, user)


def test_po_linked_reel_goes_to_floor_whole_gets_a_slitting_card_and_kg_is_conserved():
    db = SessionLocal()
    try:
        item = _paper(db)
        with patch("src.routers.purchase.emit_audit_event"):
            po = _approved_po(db, item)
        receipt = _receive(db, po, [
            {"source_reel_no": "C-100", "net_weight_kg": 1000, "width_mm": 90, "physical_form": "REEL"},
            {"source_reel_no": "R-200", "net_weight_kg": 1200, "width_mm": 1020, "physical_form": "COIL"},
        ])
        line = db.get(PurchaseOrderLine, uuid.UUID(po["lines"][0]["id"]))
        assert float(line.qty_received) == 2200 and line.received_unit_count == 2
        lots = {row["source_reel_no"]: row for row in receipt["created_lots"]}
        reel_id, coil_id = uuid.UUID(lots["C-100"]["id"]), uuid.UUID(lots["R-200"]["id"])
        assert all(row["stock_status"] == "QC_HOLD" for row in lots.values())
        with pytest.raises(HTTPException) as held:
            _issue(db, coil_id)
        assert held.value.status_code == 400 and "QC" in held.value.detail
        _pass_incoming_qc(db, reel_id, coil_id)
        db.expire_all()
        assert {db.get(PaperReel, reel_id).stock_status, db.get(PaperReel, coil_id).stock_status} == {"UNRESTRICTED"}

        # PO balance: 800 kg still open, a 900 kg receipt is refused.
        with pytest.raises(HTTPException) as over:
            _receive(db, po, [{"source_reel_no": "R-201", "net_weight_kg": 900, "width_mm": 1020, "physical_form": "COIL"}])
        assert over.value.status_code == 422

        # Routing: a reel never goes straight to the winders, a coil never to the slitter.
        with pytest.raises(HTTPException) as reel_to_winders:
            _issue(db, reel_id, issue_section="WINDER_SECTION")
        assert reel_to_winders.value.status_code == 400 and "reel" in reel_to_winders.value.detail
        with pytest.raises(HTTPException) as coil_to_slitter:
            _issue(db, coil_id, issue_section="SLITTING_SECTION")
        assert coil_to_slitter.value.status_code == 400
        # The whole reel goes out: a part issue is refused.
        with pytest.raises(HTTPException) as part:
            _issue(db, reel_id, issued_weight_kg=400)
        assert part.value.status_code == 400 and "whole" in part.value.detail

        # Reel → slitter, by shift only; consumed in full at issue; card pending.
        slit_issue = _issue(db, reel_id)
        assert slit_issue.issue_section == "SLITTING_SECTION" and slit_issue.issue_mode == "FLOOR" and slit_issue.machine_id is None
        assert slit_issue.status == "OPEN" and slit_issue.issued_weight_kg == pytest.approx(1000) and slit_issue.consumed_weight_kg == pytest.approx(1000)
        db.expire_all()
        reel = db.get(PaperReel, reel_id)
        assert reel.status.value == "CONSUMED" and float(reel.current_weight_kg) == 0
        with pytest.raises(HTTPException) as no_return:
            _close(db, slit_issue.id, 0)
        assert no_return.value.status_code == 409
        with pytest.raises(HTTPException) as too_much_waste:
            _card(db, slit_issue.id, coils_made=6, wastage_kg=1200)
        assert too_much_waste.value.status_code == 422
        carded = _card(db, slit_issue.id, coils_made=6, wastage_kg=12, coil_width_mm=45)
        assert carded.status == "CLOSED"
        assert carded.slitting_card["coils_made"] == 6 and carded.slitting_card["wastage_pct"] == pytest.approx(1.2)
        assert carded.slitting_card["good_kg"] == pytest.approx(988)
        # The card is written once; a manager corrects it with a reason, keeping the earlier card.
        with pytest.raises(HTTPException) as second:
            _card(db, slit_issue.id, coils_made=7, wastage_kg=10)
        assert second.value.status_code == 403
        corrected = _card(db, slit_issue.id, user=CHECKER, coils_made=7, wastage_kg=10, correction_reason="Recounted coils at the winder")
        assert corrected.slitting_card["coils_made"] == 7 and corrected.slitting_card["history"][0]["coils_made"] == 6

        # Coil → winders, closed on issue.
        coil_issue = _issue(db, coil_id)
        assert coil_issue.issue_section == "WINDER_SECTION" and coil_issue.status == "CLOSED" and coil_issue.consumed_weight_kg == pytest.approx(1200)
        db.expire_all()
        assert db.get(PaperReel, coil_id).status.value == "CONSUMED"
        events = {row.event_type.value for row in db.query(ReelScanEvent).filter(ReelScanEvent.reel_id == reel_id)}
        assert {"INWARD_SCAN", "ISSUE_SCAN"} <= events

        # Reconciliation counts all 2200 kg issued to the floor on the issue date.
        rows = aggregate_transactions_by_item(date(2026, 9, 25), date(2026, 9, 25), "ISSUE_PRODUCTION,ISSUE_FROM_REEL", db,
                                              {"selected_plant_id": PLANT, "scope_all": False}, MAKER)
        assert next(row for row in rows if row["item_id"] == str(item.id))["issued_kg"] == pytest.approx(2200)
    finally:
        db.close()


def test_floor_issue_never_returns_to_store():
    db = SessionLocal()
    try:
        item = _paper(db)
        with patch("src.routers.purchase.emit_audit_event"):
            po = _approved_po(db, item, qty=500)
        receipt = _receive(db, po, [{"source_reel_no": "C-900", "net_weight_kg": 500, "width_mm": 80, "physical_form": "COIL"}])
        coil_id = uuid.UUID(receipt["created_lots"][0]["id"])
        _pass_incoming_qc(db, coil_id)
        issue = _issue(db, coil_id)
        with pytest.raises(HTTPException) as closed:
            _close(db, issue.id, 0)
        assert closed.value.status_code == 409
        db.expire_all()
        coil = db.get(PaperReel, coil_id)
        assert coil.status.value == "CONSUMED" and float(coil.current_weight_kg) == 0
    finally:
        db.close()


def test_lot_received_before_qc_profile_approval_attaches_it_once():
    db = SessionLocal()
    try:
        item = ItemMaster(item_code=f"PAPER-NOQC-{uuid.uuid4().hex[:8]}", name="Kraft awaiting QC setup", type="RAW_PAPER",
                          tracking_mode="REEL", uom="KG", plant_id=PLANT, active="true")
        db.add(item)
        db.commit()
        with patch("src.routers.purchase.emit_audit_event"):
            po = _approved_po(db, item, qty=800)
        receipt = _receive(db, po, [{"source_reel_no": "NQ-1", "net_weight_kg": 800, "width_mm": 1000, "physical_form": "REEL"}])
        reel_id = uuid.UUID(receipt["created_lots"][0]["id"])
        assert db.get(PaperReel, reel_id).inward_metadata["quality_profile"]["status"] == "missing"

        with pytest.raises(HTTPException) as no_profile:
            _pass_incoming_qc(db, reel_id)
        assert no_profile.value.status_code == 409 and item.item_code in no_profile.value.detail

        item.quality_profile = {"status": "approved", "revision": 1, "parameters": [{"code": "gsm", "min": 200, "max": 260}]}
        db.commit()
        _pass_incoming_qc(db, reel_id)
        db.expire_all()
        reel = db.get(PaperReel, reel_id)
        assert reel.stock_status == "UNRESTRICTED"
        assert reel.inward_metadata["quality_profile"]["revision"] == 1
        assert reel.inward_metadata["quality_profile_attached_after_receipt"]["previous_status"] == "missing"

        # An approved pin is frozen: a later master revision does not relabel the lot.
        item = db.get(ItemMaster, item.id)
        item.quality_profile = {"status": "approved", "revision": 2, "parameters": [{"code": "gsm", "min": 240, "max": 250}]}
        db.commit()
        create_quality_inspection(QualityInspectionCreate(entity_type="REEL", entity_id=reel_id, readings={"gsm": 230}), db, PLANT, QC)
        db.expire_all()
        assert db.get(PaperReel, reel_id).inward_metadata["quality_profile"]["revision"] == 1
    finally:
        db.close()
