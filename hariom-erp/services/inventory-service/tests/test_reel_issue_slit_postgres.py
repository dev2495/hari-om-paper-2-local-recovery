"""PO receipt → coil/reel routing → slitting → winder issue → balance return.

Coils are slit before winding; reels go straight to a winder. Every slit reel
is its own labelled AT identity traced to the coil and its PO receipt, and kg
is conserved across receipt, slitting, trim and winder consumption.
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
from src.routers.reel_issues import ReelIssueClosePayload, ReelIssueCreate, close_reel_issue, create_reel_issue
from src.routers.reels import ReelSlitCreate, slit_reel

# Own plant: document series (PO, GRN, AT) stay independent of other suites.
PLANT = str(uuid.uuid4())
MAKER = {"sub": "store.maker@example.com", "roles": ["Store"], "token": ""}
CHECKER = {"sub": "plant.checker@example.com", "roles": ["PlantManager"], "token": ""}
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
    return post_governed_receipt(GovernedReceiptCreate(
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


def test_po_linked_coil_is_slit_then_reels_wind_and_kg_is_conserved():
    db = SessionLocal()
    try:
        item = _paper(db)
        with patch("src.routers.purchase.emit_audit_event"):
            po = _approved_po(db, item)
        receipt = _receive(db, po, [
            {"source_reel_no": "C-100", "net_weight_kg": 1000, "width_mm": 90, "physical_form": "COIL"},
            {"source_reel_no": "R-200", "net_weight_kg": 1200, "width_mm": 1020, "physical_form": "REEL"},
        ])
        line = db.get(PurchaseOrderLine, uuid.UUID(po["lines"][0]["id"]))
        assert float(line.qty_received) == 2200 and line.received_unit_count == 2
        lots = {row["source_reel_no"]: row for row in receipt["created_lots"]}
        coil_id, reel_id = uuid.UUID(lots["C-100"]["id"]), uuid.UUID(lots["R-200"]["id"])
        assert all(row["stock_status"] == "QC_HOLD" for row in lots.values())
        with pytest.raises(HTTPException) as held:
            _issue(db, reel_id, machine_id=WINDER, issued_weight_kg=100)
        assert held.value.status_code == 400 and "QC" in held.value.detail
        _pass_incoming_qc(db, coil_id, reel_id)
        db.expire_all()
        assert {db.get(PaperReel, coil_id).stock_status, db.get(PaperReel, reel_id).stock_status} == {"UNRESTRICTED"}

        # PO balance: 800 kg still open, a 900 kg receipt is refused.
        with pytest.raises(HTTPException) as over:
            _receive(db, po, [{"source_reel_no": "R-201", "net_weight_kg": 900, "width_mm": 1020, "physical_form": "REEL"}])
        assert over.value.status_code == 422

        # Routing: coil never goes to a winder, reel never to slitting, winder is required.
        with pytest.raises(HTTPException) as coil_to_winder:
            _issue(db, coil_id, issue_section="WINDER_SECTION", machine_id=WINDER, issued_weight_kg=1000)
        assert coil_to_winder.value.status_code == 400 and "coil" in coil_to_winder.value.detail
        with pytest.raises(HTTPException) as reel_to_slitter:
            _issue(db, reel_id, issue_section="SLITTING_SECTION", issued_weight_kg=1200)
        assert reel_to_slitter.value.status_code == 400
        with pytest.raises(HTTPException) as no_winder:
            _issue(db, reel_id, issued_weight_kg=1200)
        assert no_winder.value.status_code == 400

        # Slitting: must be issued first, cannot exceed issued kg.
        with pytest.raises(HTTPException) as not_issued:
            slit_reel(ReelSlitCreate(parent_reel_id=coil_id, children=[{"weight_kg": 400}]), db, PLANT, MAKER)
        assert not_issued.value.status_code == 409
        slit_issue = _issue(db, coil_id, issued_weight_kg=1000)  # section inferred from COIL
        assert slit_issue.issue_section == "SLITTING_SECTION" and slit_issue.reel_code == lots["C-100"]["at_no"]
        with pytest.raises(HTTPException) as bare_close:
            _close(db, slit_issue.id, 500)
        assert bare_close.value.status_code == 409
        with pytest.raises(HTTPException) as too_much:
            slit_reel(ReelSlitCreate(parent_reel_id=coil_id, children=[{"weight_kg": 600}, {"weight_kg": 400}], trim_wastage_kg=5), db, PLANT, MAKER)
        assert too_much.value.status_code == 400

        slit = slit_reel(ReelSlitCreate(parent_reel_id=coil_id, children=[
            {"weight_kg": 480, "width_mm": 45}, {"weight_kg": 470, "width_mm": 45},
        ], trim_wastage_kg=12), db, PLANT, MAKER)
        db.expire_all()
        coil = db.get(PaperReel, coil_id)
        assert slit.remaining_weight_kg == pytest.approx(38) and float(coil.current_weight_kg) == pytest.approx(38)
        assert db.get(ReelIssue, slit_issue.id).status.value == "CLOSED"
        assert float(db.get(ReelIssue, slit_issue.id).consumed_weight_kg) == pytest.approx(962)
        children = db.query(PaperReel).filter(PaperReel.parent_reel_id == coil_id).all()
        assert sorted(float(row.current_weight_kg) for row in children) == [470, 480]
        assert {row.physical_form for row in children} == {"REEL"}
        assert all((row.inward_metadata or {}).get("po_no") == po["po_no"] for row in children)
        assert db.query(LotLabelRecord).filter(LotLabelRecord.reel_id.in_([row.id for row in children])).count() == 2
        assert {row["label"]["source_reel_no"] for row in [c.model_dump() for c in slit.children]} == {"C-100 / S1", "C-100 / S2"}

        # A second slit of the leftover continues the numbering instead of colliding.
        _issue(db, coil_id, issued_weight_kg=38)
        again = slit_reel(ReelSlitCreate(parent_reel_id=coil_id, children=[{"weight_kg": 36}], trim_wastage_kg=2), db, PLANT, MAKER)
        assert again.children[0].at_no.endswith("-S3")
        db.expire_all()
        assert db.get(PaperReel, coil_id).status.value == "CONSUMED"

        # Slit reel and the received reel both go to the winder (legacy alias saves the machine).
        child = children[0]
        winder_issue = _issue(db, child.id, winder_machine_id=WINDER, issued_weight_kg=float(child.current_weight_kg))
        assert winder_issue.issue_section == "WINDER_SECTION" and winder_issue.machine_id == WINDER
        closed = _close(db, winder_issue.id, 300)
        db.expire_all()
        assert closed.remaining_weight_kg == pytest.approx(float(child.inward_weight_kg) - 300)
        returned = db.get(PaperReel, child.id)
        assert returned.status.value == "IN_STOCK" and float(returned.current_weight_kg) == pytest.approx(float(child.inward_weight_kg) - 300)

        reel_issue = _issue(db, reel_id, machine_id=WINDER, issued_weight_kg=1200)
        _close(db, reel_issue.id, 1200)
        db.expire_all()
        assert db.get(PaperReel, reel_id).status.value == "CONSUMED"
        events = {row.event_type.value for row in db.query(ReelScanEvent).filter(ReelScanEvent.reel_id == coil_id)}
        assert {"INWARD_SCAN", "ISSUE_SCAN", "SLIT_SCAN"} <= events
    finally:
        db.close()


def test_coil_can_return_to_store_unslit():
    db = SessionLocal()
    try:
        item = _paper(db)
        with patch("src.routers.purchase.emit_audit_event"):
            po = _approved_po(db, item, qty=500)
        receipt = _receive(db, po, [{"source_reel_no": "C-900", "net_weight_kg": 500, "width_mm": 80, "physical_form": "COIL"}])
        coil_id = uuid.UUID(receipt["created_lots"][0]["id"])
        _pass_incoming_qc(db, coil_id)
        issue = _issue(db, coil_id, issued_weight_kg=500)
        _close(db, issue.id, 0)
        db.expire_all()
        coil = db.get(PaperReel, coil_id)
        assert coil.status.value == "IN_STOCK" and float(coil.current_weight_kg) == 500
    finally:
        db.close()
