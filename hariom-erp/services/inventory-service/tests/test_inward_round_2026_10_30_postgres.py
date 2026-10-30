"""Client round 2026-10-30 (part C1): invoice rate on a pending-invoice GRN, its review case, and
backdated GRN lots dated by the received date (live PostgreSQL)."""
import os
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema
from src.database import Base, SessionLocal, engine
from src.models import ItemMaster, PaperReel, PurchaseOrderRevision, PurchaseReceipt, StockBatch, SupplierInvoice
from src.routers.manual_receipts import ManualReceiptCreate, post_manual_receipt
from src.routers.procurement import (
    AttachInvoiceRequest, DebitNoteCreate, DiscrepancyAction, GovernedReceiptCreate, act_on_discrepancy,
    attach_invoice_to_receipt, create_debit_note, get_governed_receipt, list_discrepancies, post_governed_receipt,
    preview_receipt,
)
from src.routers.purchase import PurchaseOrderCreate, RevisionActionPayload, approve_purchase_order, create_purchase_order, submit_purchase_order
from src.services.stock_lots import lot_row

PLANT = str(uuid.uuid4())
MAKER = {"sub": "store.maker@example.com", "roles": ["Store"], "token": ""}
CHECKER = {"sub": "plant.owner@example.com", "roles": ["Owner"], "token": ""}
HEAD = {"sub": "plant.head@example.com", "roles": ["PlantManager"], "token": ""}


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()


def _item(db, kind, *, tracking="BULK", uom="KG"):
    item = ItemMaster(item_code=f"{kind[:4]}-{uuid.uuid4().hex[:8]}", name=f"{kind.title()} test", type=kind,
                      tracking_mode=tracking, uom=uom, plant_id=PLANT, active="true",
                      quality_profile={"status": "approved", "revision": 1, "parameters": [{"code": "gsm", "min": 200, "max": 260}]})
    db.add(item)
    db.commit()
    return item


def _po(db, item, qty=5000, rate=30):
    created = create_purchase_order(PurchaseOrderCreate(
        request_id=uuid.uuid4(), category="RM_PM", supplier_id=uuid.uuid4(), supplier_name="Rate mill",
        expected_date=date(2026, 10, 30), lines=[{"item_id": item.id, "qty_ordered": qty, "unit_cost": rate, "uom": "KG"}],
    ), db, PLANT, MAKER)
    revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created["id"]).one()
    submitted = submit_purchase_order(created["id"], RevisionActionPayload(expected_version=created["version"], content_hash=revision.content_hash, reason="Ready"), db, PLANT, MAKER)
    return approve_purchase_order(created["id"], RevisionActionPayload(expected_version=submitted["version"], content_hash=revision.content_hash, reason="Approved"), db, PLANT, CHECKER)


def _pending(po, *, rate=None, kg=600, on=date(2026, 10, 30)):
    line = {"po_line_id": uuid.UUID(po["lines"][0]["id"]),
            "lots": [{"source_reel_no": f"R-{uuid.uuid4().hex[:6]}", "net_weight_kg": kg, "width_mm": 900, "physical_form": "REEL"}]}
    if rate is not None:
        line["invoice_rate"] = rate
    return GovernedReceiptCreate(request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=on,
                                 supplier_challan_no=f"CH-{uuid.uuid4().hex[:6]}", invoice_pending=True, lines=[line])


def _cases(db, receipt_id):
    rows = list_discrepancies(status=None, limit=1000, db=db, plant_id=PLANT, current_user=HEAD)["items"]
    return [row for row in rows if row["receipt_id"] == receipt_id]


def _attach(db, receipt, rate):
    saved = get_governed_receipt(uuid.UUID(receipt["id"]), db, PLANT, MAKER)
    return attach_invoice_to_receipt(uuid.UUID(receipt["id"]), AttachInvoiceRequest(
        expected_version=saved["posting_version"], invoice_no=f"INV-{uuid.uuid4().hex[:6]}", invoice_date=date(2026, 11, 2),
        lines=[{"receipt_line_id": line["id"], "invoice_rate": rate} for line in saved["lines"]],
    ), db, PLANT, MAKER)


def test_pending_invoice_grn_keeps_the_challan_rate_and_opens_the_rate_case_now():
    with SessionLocal() as db:
        paper = _item(db, "RAW_PAPER", tracking="REEL")
        po = _po(db, paper)
        preview = preview_receipt(_pending(po, rate=32.5), db, PLANT, MAKER)
        assert preview["lines"][0]["commercial_status"] == "INVOICE_PENDING" and preview["lines"][0]["rate_review"] is True
        assert preview["lines"][0]["rate_delta"] == 2.5

        posted = post_governed_receipt(_pending(po, rate=32.5), db, PLANT, MAKER)
        assert posted["invoice_pending"] is True and posted["commercial_status"] == "INVOICE_PENDING"
        assert posted["invoice_no"] is None and posted["invoice_date"] is None
        assert posted["rate_review_cases"] and posted["rate_review_cases"][0]["invoice_rate"] == 32.5
        line = posted["lines"][0]
        assert line["invoice_rate"] == 32.5 and line["po_rate"] == 30 and line["rate_review_open"] is True
        # Lots say which GRN line they came on, so Inspect opens the right one in incoming QC.
        assert posted["lots"][0]["entity_type"] == "REEL" and posted["lots"][0]["receipt_line_id"] == line["id"]

        cases = _cases(db, posted["id"])
        assert [(row["type"], row["status"], row["invoice_pending"], row["invoice_no"]) for row in cases] == [("RATE", "OPEN", True, None)]
        assert cases[0]["po_rate"] == 30 and cases[0]["invoice_rate"] == 32.5 and cases[0]["claimable_amount"] == 1500
        # Not a supplier invoice: the GRN still shows the invoice as pending.
        assert db.get(PurchaseReceipt, uuid.UUID(posted["id"])).supplier_invoice_id is None

        same = post_governed_receipt(_pending(po, rate=30), db, PLANT, MAKER)
        assert same["rate_review_cases"] == [] and _cases(db, same["id"]) == []
        assert same["lines"][0]["invoice_rate"] == 30
        blank = post_governed_receipt(_pending(po), db, PLANT, MAKER)
        assert blank["lines"][0]["invoice_rate"] is None and _cases(db, blank["id"]) == []


def test_attaching_the_invoice_later_moves_the_same_case_onto_it():
    with SessionLocal() as db:
        paper = _item(db, "RAW_PAPER", tracking="REEL")
        po = _po(db, paper)
        posted = post_governed_receipt(_pending(po, rate=32.5), db, PLANT, MAKER)
        case_id = _cases(db, posted["id"])[0]["id"]

        attached = _attach(db, posted, 32.5)
        assert attached["invoice_pending"] is False and attached["invoice_no"]
        assert attached["commercial_status"] == "REVIEW_REQUIRED"
        cases = _cases(db, posted["id"])
        assert [(row["id"], row["type"], row["status"], row["invoice_pending"]) for row in cases] == [(case_id, "RATE", "OPEN", False)]
        assert cases[0]["invoice_no"] == attached["invoice_no"]
        holders = db.query(SupplierInvoice).filter(SupplierInvoice.normalized_invoice_no == f"PENDING:{posted['id']}").all()
        assert holders == []

        # The invoice came at the PO rate: the challan-rate case closes by itself.
        other = post_governed_receipt(_pending(po, rate=31), db, PLANT, MAKER)
        cleared = _attach(db, other, 30)
        assert cleared["commercial_status"] == "CLEAR"
        resolved = _cases(db, other["id"])
        assert [(row["type"], row["status"]) for row in resolved] == [("RATE", "RESOLVED")]
        # The resolved row shows the invoice as it came (no difference left); the challan rate stays as evidence.
        assert (resolved[0]["po_rate"], resolved[0]["invoice_rate"], resolved[0]["delta"], resolved[0]["claimable_amount"]) == (30, 30, 0, 0)
        assert resolved[0]["evidence"]["challan_rate"] == 31

        # A different rate on the invoice updates the open case instead of adding a second one.
        third = post_governed_receipt(_pending(po, rate=31), db, PLANT, MAKER)
        changed = _attach(db, third, 33)
        assert changed["commercial_status"] == "REVIEW_REQUIRED"
        rows = _cases(db, third["id"])
        assert [(row["type"], row["status"], row["invoice_rate"]) for row in rows] == [("RATE", "OPEN", 33)]


def test_a_case_decided_before_the_invoice_keeps_the_grn_pending_and_its_decision():
    with SessionLocal() as db:
        paper = _item(db, "RAW_PAPER", tracking="REEL")
        po = _po(db, paper)
        posted = post_governed_receipt(_pending(po, rate=32), db, PLANT, MAKER)
        case = _cases(db, posted["id"])[0]
        accepted = act_on_discrepancy(uuid.UUID(case["id"]), DiscrepancyAction(action="ACCEPT_VARIANCE", expected_version=case["version"], reason="Agreed with mill"), db, PLANT, HEAD)
        assert accepted["status"] == "ACCEPTED"
        receipt = db.get(PurchaseReceipt, uuid.UUID(posted["id"]))
        db.refresh(receipt)
        assert receipt.invoice_pending is True and receipt.commercial_status == "INVOICE_PENDING"

        with pytest.raises(HTTPException) as refused:
            create_debit_note(DebitNoteCreate(request_id=uuid.uuid4(), note_date=date(2026, 10, 30), discrepancy_ids=[uuid.UUID(case["id"])], reason="Claim the rate"), db, PLANT, HEAD)
        assert refused.value.status_code == 409

        attached = _attach(db, posted, 32)
        assert attached["commercial_status"] == "CLEAR"
        assert [(row["status"]) for row in _cases(db, posted["id"])] == ["ACCEPTED"]
        reel = db.get(PaperReel, uuid.UUID(posted["lots"][0]["id"]))
        assert reel.unit_cost == 32


def test_backdated_grn_lots_are_dated_and_coded_by_the_received_date():
    with SessionLocal() as db:
        paper = _item(db, "RAW_PAPER", tracking="REEL")
        po = _po(db, paper)
        february = date(2026, 2, 5)
        posted = post_governed_receipt(_pending(po, on=february), db, PLANT, MAKER)
        reel = db.get(PaperReel, uuid.UUID(posted["lots"][0]["id"]))
        assert reel.reel_code.startswith("AT-260205-") and reel.inward_date == february
        assert lot_row(reel, paper, reel.current_weight_kg)["in_since"] == "2026-02-05"
        # Today's receipts keep today's code, in their own sequence.
        today = post_governed_receipt(_pending(po, on=date(2026, 10, 30)), db, PLANT, MAKER)
        assert db.get(PaperReel, uuid.UUID(today["lots"][0]["id"])).reel_code.startswith("AT-261030-")

        glue = _item(db, "ADHESIVE")
        manual = post_manual_receipt(ManualReceiptCreate(
            request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Glue works", reason="Local purchase",
            received_date=february, supplier_challan_no="DC 77", invoice_pending=True,
            lines=[{"item_id": glue.id, "quantity": 120, "invoice_rate": 88}],
        ), db, PLANT, MAKER)
        batch = db.get(StockBatch, uuid.UUID(manual["lots"][0]["id"]))
        assert lot_row(batch, glue, 120)["in_since"] == "2026-02-05"
        assert manual["lines"][0]["invoice_rate"] == 88 and manual["lots"][0]["entity_type"] == "BATCH"

        manual_paper = post_manual_receipt(ManualReceiptCreate(
            request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Paper co", reason="Local purchase",
            received_date=february, supplier_challan_no="DC 78", invoice_pending=True,
            lines=[{"item_id": paper.id, "lots": [{"source_reel_no": f"M-{uuid.uuid4().hex[:5]}", "net_weight_kg": 300, "width_mm": 900, "physical_form": "REEL"}]}],
        ), db, PLANT, MAKER)
        assert db.get(PaperReel, uuid.UUID(manual_paper["lots"][0]["id"])).reel_code.startswith("AT-260205-")


def test_goods_inward_refuses_the_scrap_area_but_takes_a_store_rack_or_the_qc_bay():
    from src.models import InventoryLocation
    from src.routers.procurement import GovernedReceiptLineInput, _validate_receipt

    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        def rack(code, purpose):
            row = InventoryLocation(plant_id=plant, code=code, warehouse="Main", purpose=purpose, active="true")
            db.add(row)
            return row
        scrap, qc_bay, store, legacy = rack("SCR-1", "SCRAP"), rack("QC-1", "QC"), rack("RM-1", "STORAGE"), rack("OLD-1", None)
        db.commit()

        def receipt(location):
            return GovernedReceiptCreate(request_id=uuid.uuid4(), purchase_order_id=uuid.uuid4(), received_date=date(2026, 10, 30), supplier_challan_no="CH-1",
                                         invoice_pending=True, lines=[GovernedReceiptLineInput(po_line_id=uuid.uuid4(), quantity=1, location_id=location.id)])

        with pytest.raises(HTTPException) as refused:
            _validate_receipt(receipt(scrap), db, plant)
        assert refused.value.status_code == 422 and "scrap area" in refused.value.detail
        for allowed in (qc_bay, store, legacy):
            _validate_receipt(receipt(allowed), db, plant)
