"""Client round 2026-10-26: inward number series, supplier challan, PO-quantity rule, net weight
only, reel-wise QC context and issue units (live PostgreSQL)."""
import os
import uuid
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema
from src.database import Base, SessionLocal, engine
from src.models import (
    DocumentSeries, ItemMaster, LotLabelRecord, PaperReel, PurchaseReceipt, PurchaseOrderRevision,
    ReelIssue, StockBatch, StockTransaction, TransactionType, ReferenceType,
)
from src.routers.issue import IssueCreate, create_issue
from src.routers.manual_receipts import ManualReceiptCreate, post_manual_receipt
from src.routers.procurement import GovernedReceiptCreate, post_governed_receipt, preview_receipt
from src.routers.purchase import PurchaseOrderCreate, RevisionActionPayload, approve_purchase_order, create_purchase_order, submit_purchase_order
from src.routers.quality import list_pending_quality
from src.routers.reel_issues import ReelIssueCreate, WeightIssueCreate, create_reel_issue, issue_parchment_by_weight

PLANT = str(uuid.uuid4())
OTHER_PLANT = str(uuid.uuid4())
MAKER = {"sub": "store.maker@example.com", "roles": ["Store"], "token": ""}
CHECKER = {"sub": "plant.owner@example.com", "roles": ["Owner"], "token": ""}
QC = {"sub": "qc@example.com", "roles": ["QC"], "actual_roles": ["QC"], "token": ""}


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()


def _item(db, kind, *, tracking="BULK", uom="KG", plant=PLANT, nominals=None):
    item = ItemMaster(item_code=f"{kind[:4]}-{uuid.uuid4().hex[:8]}", name=f"{kind.title()} test", type=kind,
                      tracking_mode=tracking, uom=uom, plant_id=plant, active="true", qc_nominals=nominals,
                      quality_profile={"status": "approved", "revision": 1, "parameters": [{"code": "gsm", "min": 200, "max": 260}]})
    db.add(item)
    db.commit()
    return item


def _po(db, lines, plant=PLANT, supplier=None):
    created = create_purchase_order(PurchaseOrderCreate(
        request_id=uuid.uuid4(), category="RM_PM", supplier_id=supplier or uuid.uuid4(), supplier_name="Round mill",
        expected_date=date(2026, 10, 30), lines=lines,
    ), db, plant, MAKER)
    revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created["id"]).one()
    submitted = submit_purchase_order(created["id"], RevisionActionPayload(expected_version=created["version"], content_hash=revision.content_hash, reason="Ready"), db, plant, MAKER)
    return approve_purchase_order(created["id"], RevisionActionPayload(expected_version=submitted["version"], content_hash=revision.content_hash, reason="Approved"), db, plant, CHECKER)


def _receipt(po, line_rows, *, challan=None, on=date(2026, 10, 26), reason=None):
    return GovernedReceiptCreate(
        request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=on,
        supplier_challan_no=challan or f"CH-{uuid.uuid4().hex[:6]}",
        invoice_no=f"INV-{uuid.uuid4().hex[:6]}", invoice_date=on, over_receipt_reason=reason, lines=line_rows,
    )


def _paper_line(po, kg, prefix="R"):
    return {"po_line_id": uuid.UUID(po["lines"][0]["id"]), "invoice_rate": 30,
            "lots": [{"source_reel_no": f"{prefix}-{uuid.uuid4().hex[:6]}", "net_weight_kg": kg, "width_mm": 900, "physical_form": "REEL"}]}


def test_inward_numbers_follow_material_series_and_restart_each_year():
    with SessionLocal() as db:
        paper = _item(db, "RAW_PAPER", tracking="REEL", nominals={"gsm": 230, "bf": 18})
        adhesive = _item(db, "ADHESIVE")
        parchment = _item(db, "PARCHMENT", tracking="REEL")
        paper_po = _po(db, [{"item_id": paper.id, "qty_ordered": 5000, "unit_cost": 30, "uom": "KG"}])
        first = post_governed_receipt(_receipt(paper_po, [_paper_line(paper_po, 800)]), db, PLANT, MAKER)
        second = post_governed_receipt(_receipt(paper_po, [_paper_line(paper_po, 700)]), db, PLANT, MAKER)
        assert (first["grn_no"], second["grn_no"]) == ("P/26/001", "P/26/002")
        # Quality specification is no longer on the PO: the reel takes the master's nominal GSM.
        reel = db.get(PaperReel, uuid.UUID(first["lots"][0]["id"]))
        assert reel.gsm == 230 and reel.gross_weight_kg is None and reel.tare_weight_kg is None
        assert (reel.inward_metadata or {}).get("grn_no") == "P/26/001"
        label = db.query(LotLabelRecord).filter_by(reel_id=reel.id).one().content_snapshot
        assert label["grn_no"] == "P/26/001" and label["challan_no"] == first["supplier_challan_no"]

        adhesive_grn = post_manual_receipt(ManualReceiptCreate(
            request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Glue works", reason="Local purchase",
            received_date=date(2026, 10, 26), supplier_challan_no="DC 9", invoice_no=f"G-{uuid.uuid4().hex[:6]}",
            invoice_date=date(2026, 10, 26), lines=[{"item_id": adhesive.id, "quantity": 200, "invoice_rate": 90}],
        ), db, PLANT, MAKER)
        assert adhesive_grn["grn_no"] == "A/26/001"
        batch = db.query(StockBatch).filter_by(item_id=adhesive.id).one()
        assert batch.batch_no.startswith("A/26/001")

        parchment_grn = post_manual_receipt(ManualReceiptCreate(
            request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Parchment co", reason="Local purchase",
            received_date=date(2026, 10, 26), supplier_challan_no="PC-1", invoice_pending=True,
            lines=[{"item_id": parchment.id, "lots": [{"source_reel_no": f"C-{uuid.uuid4().hex[:5]}", "net_weight_kg": 40, "width_mm": 90, "physical_form": "COIL"}]}],
        ), db, PLANT, MAKER)
        assert parchment_grn["grn_no"] == "IN/26/001"

        mixed_po = _po(db, [{"item_id": paper.id, "qty_ordered": 1000, "unit_cost": 30, "uom": "KG"},
                            {"item_id": adhesive.id, "qty_ordered": 100, "unit_cost": 90, "uom": "KG"}])
        mixed = post_governed_receipt(_receipt(mixed_po, [
            _paper_line(mixed_po, 500),
            {"po_line_id": uuid.UUID(mixed_po["lines"][1]["id"]), "quantity": 50, "invoice_rate": 90},
        ]), db, PLANT, MAKER)
        assert mixed["grn_no"] == "IN/26/002"

        # The year restarts on 1 April (financial year), not on 1 January.
        january = post_governed_receipt(_receipt(paper_po, [_paper_line(paper_po, 300)], on=date(2027, 1, 2)), db, PLANT, MAKER)
        assert january["grn_no"] == "P/26/003"
        next_year = post_governed_receipt(_receipt(paper_po, [_paper_line(paper_po, 300)], on=date(2027, 4, 1)), db, PLANT, MAKER)
        assert next_year["grn_no"] == "P/27/001"
        other_plant_paper = _item(db, "RAW_PAPER", tracking="REEL", plant=OTHER_PLANT)
        other_po = _po(db, [{"item_id": other_plant_paper.id, "qty_ordered": 900, "unit_cost": 30, "uom": "KG"}], plant=OTHER_PLANT)
        assert post_governed_receipt(_receipt(other_po, [_paper_line(other_po, 400)]), db, OTHER_PLANT, MAKER)["grn_no"] == "P/26/001"
        counters = {row.category: row.next_value for row in db.query(DocumentSeries).filter_by(plant_id=PLANT, document_type="GRN")}
        assert counters == {"PAPER-26": 4, "ADHESIVE-26": 2, "GENERAL-26": 3, "PAPER-27": 2}


def test_challan_is_required_and_a_repeat_by_the_same_supplier_only_warns():
    with SessionLocal() as db:
        paper = _item(db, "RAW_PAPER", tracking="REEL")
        supplier = uuid.uuid4()
        po = _po(db, [{"item_id": paper.id, "qty_ordered": 3000, "unit_cost": 30, "uom": "KG"}], supplier=supplier)
        with pytest.raises(ValueError):
            GovernedReceiptCreate(request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=date(2026, 10, 26),
                                  supplier_challan_no="  - ", invoice_pending=True, lines=[_paper_line(po, 100)])
        first = post_governed_receipt(_receipt(po, [_paper_line(po, 500)], challan="CH/501"), db, PLANT, MAKER)
        assert first["supplier_challan_no"] == "CH/501" and first["warnings"] == []
        repeat = _receipt(po, [_paper_line(po, 400)], challan="ch 501")
        preview = preview_receipt(repeat, db, PLANT, MAKER)
        assert preview["warnings"] and first["grn_no"] in preview["warnings"][0]
        second = post_governed_receipt(repeat, db, PLANT, MAKER)
        assert second["grn_no"] != first["grn_no"] and second["warnings"]
        receipt = db.get(PurchaseReceipt, uuid.UUID(second["id"]))
        assert receipt.supplier_challan_key == "CH501"


def test_receipt_follows_po_open_quantity_and_more_needs_a_reason():
    with SessionLocal() as db:
        adhesive = _item(db, "ADHESIVE")
        po = _po(db, [{"item_id": adhesive.id, "qty_ordered": 100, "unit_cost": 90, "uom": "KG"}])
        line_id = uuid.UUID(po["lines"][0]["id"])
        post_governed_receipt(_receipt(po, [{"po_line_id": line_id, "quantity": 60, "invoice_rate": 90}]), db, PLANT, MAKER)
        over = _receipt(po, [{"po_line_id": line_id, "quantity": 55, "invoice_rate": 90}])
        with pytest.raises(HTTPException) as blocked:
            preview_receipt(over, db, PLANT, MAKER)
        assert blocked.value.status_code == 422 and "40 kg still open" in blocked.value.detail and "reason" in blocked.value.detail
        with pytest.raises(HTTPException):
            post_governed_receipt(over, db, PLANT, MAKER)
        db.rollback()
        allowed = _receipt(po, [{"po_line_id": line_id, "quantity": 55, "invoice_rate": 90}], reason="Supplier sent the full drum")
        assert preview_receipt(allowed, db, PLANT, MAKER)["lines"][0]["over_po_qty"] == 15
        saved = post_governed_receipt(allowed, db, PLANT, MAKER)
        history = [row for row in saved["approval_history"] if row["action"] == "OVER_RECEIPT"]
        assert history and history[0]["reason"] == "Supplier sent the full drum" and history[0]["lines"][0]["over_qty"] == 15


def test_pending_qc_rows_carry_their_grn_line_and_vendor_reel_number():
    with SessionLocal() as db:
        paper = _item(db, "RAW_PAPER", tracking="REEL")
        po = _po(db, [{"item_id": paper.id, "qty_ordered": 3000, "unit_cost": 30, "uom": "KG", "incoming_qc_required": True}])
        line_id = uuid.UUID(po["lines"][0]["id"])
        saved = post_governed_receipt(_receipt(po, [{"po_line_id": line_id, "invoice_rate": 30, "lots": [
            {"source_reel_no": "VR-1", "net_weight_kg": 400, "width_mm": 900},
            {"source_reel_no": "VR-2", "net_weight_kg": 450, "width_mm": 900}]}], challan="RW-77"), db, PLANT, MAKER)
        rows = [row for row in list_pending_quality(db, {"selected_plant_id": PLANT, "allowed_plants": [PLANT]}, QC)
                if str(row.entity_id) in {lot["id"] for lot in saved["lots"]}]
        assert len(rows) == 2
        assert {row.unit_ref for row in rows} == {"VR-1", "VR-2"}
        assert {str(row.receipt_line_id) for row in rows} == {saved["lines"][0]["id"]}
        assert {row.challan_no for row in rows} == {"RW-77"} and {row.grn_no for row in rows} == {saved["grn_no"]}


def _coil(db, item, kg, day):
    coil = PaperReel(plant_id=uuid.UUID(PLANT), reel_code=f"AT-{uuid.uuid4().hex[:8]}", paper_id=item.id, inward_weight_kg=kg,
                     current_weight_kg=kg, physical_form="COIL", stock_status="UNRESTRICTED", inward_date=day)
    db.add(coil)
    db.commit()
    return coil


def test_parchment_goes_out_by_colour_and_kg_oldest_coils_first():
    with SessionLocal() as db:
        red = _item(db, "PARCHMENT", tracking="REEL")
        old = _coil(db, red, 30, date(2026, 10, 1))
        new = _coil(db, red, 50, date(2026, 10, 20))
        with patch("src.routers.reel_issues.emit_audit_event"):
            with pytest.raises(HTTPException) as whole:
                create_reel_issue(ReelIssueCreate(reel_id=old.id, shift="A", issue_date=date(2026, 10, 26)), db, PLANT, MAKER)
            assert whole.value.status_code == 400 and "colour and kg" in whole.value.detail
            with pytest.raises(HTTPException) as too_much:
                issue_parchment_by_weight(WeightIssueCreate(item_id=red.id, qty_kg=81, shift="A", issue_date=date(2026, 10, 26)), db, PLANT, MAKER)
            assert "Only 80 kg" in too_much.value.detail
            result = issue_parchment_by_weight(WeightIssueCreate(item_id=red.id, qty_kg=45.5, shift="B", issue_date=date(2026, 10, 26)), db, PLANT, MAKER)
        assert result["issued_kg"] == 45.5 and result["available_after_kg"] == 34.5
        assert [(row["reel_code"], row["issued_kg"]) for row in result["coils"]] == [(old.reel_code, 30), (new.reel_code, 15.5)]
        db.refresh(old); db.refresh(new)
        assert old.current_weight_kg == 0 and str(old.status.value) == "CONSUMED"
        assert new.current_weight_kg == 34.5 and str(new.status.value) == "IN_STOCK"
        issues = db.query(ReelIssue).filter(ReelIssue.reel_id.in_([old.id, new.id])).all()
        assert sorted(row.issued_weight_kg for row in issues) == [15.5, 30] and {row.issue_mode for row in issues} == {"FLOOR"}


def _lot(db, item, qty, status="UNRESTRICTED"):
    batch = StockBatch(item_id=item.id, batch_no=f"LOT-{uuid.uuid4().hex[:6]}", received_qty=qty, stock_status=status, plant_id=PLANT)
    db.add(batch)
    db.flush()
    db.add(StockTransaction(item_id=item.id, batch_id=batch.id, transaction_type=TransactionType.INWARD, qty_change=qty,
                            reference_type=ReferenceType.PURCHASE, reference_id=uuid.uuid4(), plant_id=PLANT, stock_status=status))
    db.commit()
    return batch


def test_floor_issue_units_and_on_hand_limits():
    with SessionLocal() as db:
        boxes = _item(db, "PACKAGING", uom="PCS")
        _lot(db, boxes, 40)
        _lot(db, boxes, 30)
        _lot(db, boxes, 500, status="QC_HOLD")
        with patch("src.routers.issue.emit_audit_event"):
            with pytest.raises(HTTPException) as fraction:
                create_issue(IssueCreate(item_id=boxes.id, qty=2.5, shift="A"), db, PLANT, MAKER)
            assert fraction.value.status_code == 422 and "whole number" in fraction.value.detail
            with pytest.raises(HTTPException) as too_many:
                create_issue(IssueCreate(item_id=boxes.id, qty=71, shift="A"), db, PLANT, MAKER)
            assert too_many.value.status_code == 400 and "Only 70 pcs" in too_many.value.detail
            done = create_issue(IssueCreate(item_id=boxes.id, qty=55, shift="A", external_ref=f"FLOOR-{uuid.uuid4().hex[:8]}"), db, PLANT, MAKER)
        parts = db.query(StockTransaction).filter_by(item_id=boxes.id, transaction_type=TransactionType.ISSUE_PRODUCTION).all()
        assert sorted(-row.qty_change for row in parts) == [15, 40] and done.item_balance == 515
