"""Review fixes 3 Nov 2026 (live PostgreSQL).

1. An approval after a revision that left nothing open settles the PO (RECEIVED), not APPROVED; a PO
   already stuck at APPROVED with nothing open is closed by short close.
2. A GRN billed for more kg than came in opens a QUANTITY case with a claim (extra kg x billed rate), so a
   debit note can be made; billed less than came in opens a case with no claim.
3. A debit note is voided with a DEBIT_NOTE reason; its cases open again.
6. Records of another plant are not found (404) by id, for reads and writes.
"""
import os
import uuid
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema
from src.database import Base, SessionLocal, engine
from src.models import ItemMaster, PurchaseDiscrepancy, PurchaseOrder, PurchaseOrderRevision, PurchaseReceiptLine, ReceiptInvoiceAllocation
from src.routers.procurement import (
    DebitNoteAction, DebitNoteCreate, DiscrepancyAction, GovernedReceiptCreate,
    act_on_debit_note, act_on_discrepancy, create_debit_note, get_governed_receipt, get_lot, post_governed_receipt,
)
from src.routers.purchase import (
    PurchaseOrderCreate, PurchaseRevisionCreate, RevisionActionPayload, ShortClosePayload,
    approve_purchase_order, create_purchase_order, create_purchase_order_revision, get_purchase_order,
    purchase_order_history, short_close_purchase_order, submit_purchase_order,
)
from src.services.procurement import quantity_claim

PLANT = str(uuid.uuid4())
OTHER_PLANT = str(uuid.uuid4())
MAKER = {"sub": "store.fix@example.com", "roles": ["Store"], "token": ""}
CHECKER = {"sub": "owner.fix@example.com", "roles": ["Owner"], "actual_roles": ["Owner"], "role": "Owner", "token": ""}
ACCOUNTS = {"sub": "accounts.fix@example.com", "roles": ["Accounts"], "token": ""}
HEAD = {"sub": "pm.fix@example.com", "roles": ["PlantManager"], "token": ""}
HEADER = dict(category="RM_PM", supplier_name="Fix mill", expected_date=date(2026, 11, 9))


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()


def _item(db):
    item = ItemMaster(item_code=f"FIX-{uuid.uuid4().hex[:8]}", name="Fix adhesive", type="ADHESIVE", tracking_mode="BULK", uom="KG",
                      plant_id=PLANT, active="true",
                      quality_profile={"status": "approved", "revision": 1, "parameters": [{"code": "viscosity", "min": 1, "max": 9}]})
    db.add(item)
    db.commit()
    return item


def _approve(db, po):
    revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=po["id"]).order_by(PurchaseOrderRevision.revision_no.desc()).first()
    submitted = submit_purchase_order(po["id"], RevisionActionPayload(expected_version=po["version"], content_hash=revision.content_hash, reason="Ready"), db, PLANT, MAKER)
    with patch("src.routers.purchase.emit_audit_event"):
        return approve_purchase_order(po["id"], RevisionActionPayload(expected_version=submitted["version"], content_hash=revision.content_hash, reason="Ok"), db, PLANT, CHECKER)


def _approved_po(db, item, supplier, qty=100, rate=20):
    created = create_purchase_order(PurchaseOrderCreate(request_id=uuid.uuid4(), supplier_id=supplier, **HEADER,
        lines=[{"item_id": item.id, "qty_ordered": qty, "unit_cost": rate, "uom": "KG"}]), db, PLANT, MAKER)
    return _approve(db, created)


def _grn(db, po, *, quantity, invoice_quantity, rate=20):
    return post_governed_receipt(GovernedReceiptCreate(
        request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=date(2026, 10, 30), supplier_challan_no=f"CH-{uuid.uuid4().hex[:6]}",
        invoice_no=f"INV-{uuid.uuid4().hex[:6]}", invoice_date=date(2026, 10, 30),
        lines=[{"po_line_id": uuid.UUID(po["lines"][0]["id"]), "invoice_rate": rate, "quantity": quantity, "invoice_quantity": invoice_quantity}]), db, PLANT, MAKER)


def _qty_case(db, grn_id):
    return (db.query(PurchaseDiscrepancy)
            .join(ReceiptInvoiceAllocation, ReceiptInvoiceAllocation.id == PurchaseDiscrepancy.allocation_id)
            .join(PurchaseReceiptLine, PurchaseReceiptLine.id == ReceiptInvoiceAllocation.receipt_line_id)
            .filter(PurchaseReceiptLine.receipt_id == uuid.UUID(str(grn_id)), PurchaseDiscrepancy.discrepancy_type == "QUANTITY").one())


def test_quantity_claim_rule():
    assert quantity_claim(110, 100, 20) == Decimal("200.00")
    assert quantity_claim(100, 100, 20) == Decimal("0.00")
    assert quantity_claim(90, 100, 20) == Decimal("0.00")


def test_approval_after_revision_to_received_qty_settles_the_po():
    with SessionLocal() as db:
        item = _item(db)
        supplier = uuid.uuid4()
        po = _approved_po(db, item, supplier)
        _grn(db, po, quantity=60, invoice_quantity=60)
        po = get_purchase_order(po["id"], db, PLANT, MAKER)
        assert po["status"] == "PARTIALLY_RECEIVED"
        line = po["lines"][0]
        revised = create_purchase_order_revision(po["id"], PurchaseRevisionCreate(
            request_id=uuid.uuid4(), supplier_id=supplier, **HEADER, reason_code="PV-QTY", reason_note="Only 60 kg needed",
            expected_version=po["version"], lines=[{"item_id": item.id, "logical_line_id": line["logical_line_id"], "qty_ordered": 60, "unit_cost": 20, "uom": "KG"}]),
            db, PLANT, MAKER)
        approved = _approve(db, revised)
        assert approved["status"] == "RECEIVED"
        assert approved["lines"][0]["line_status"] == "CLOSED"


def test_short_close_unsticks_an_approved_po_with_nothing_open():
    with SessionLocal() as db:
        item = _item(db)
        po = _approved_po(db, item, uuid.uuid4())
        _grn(db, po, quantity=100, invoice_quantity=100)
        # Stuck as the live bug left it: every kg in, status still APPROVED.
        db.query(PurchaseOrder).filter_by(id=po["id"]).update({"status": "APPROVED"})
        db.commit()
        version = db.query(PurchaseOrder).filter_by(id=po["id"]).one().version
        closed = short_close_purchase_order(po["id"], ShortClosePayload(expected_version=version), db, PLANT, HEAD)
        assert closed["status"] == "RECEIVED"


def test_over_billed_grn_claims_and_debit_note_voids_with_reason():
    with SessionLocal() as db:
        item = _item(db)
        po = _approved_po(db, item, uuid.uuid4())
        over = _grn(db, po, quantity=50, invoice_quantity=55, rate=20)
        case = _qty_case(db, over["id"])
        assert case.claimable_amount == Decimal("100.00")  # 5 kg billed but not received x Rs 20
        under = _grn(db, po, quantity=50, invoice_quantity=45, rate=20)
        assert _qty_case(db, under["id"]).claimable_amount == Decimal("0.00")

        note = create_debit_note(DebitNoteCreate(request_id=uuid.uuid4(), note_date=date(2026, 10, 31), discrepancy_ids=[case.id],
                                                 reason_code="DN-QTY", reason_note="Billed 5 kg more"), db, PLANT, ACCOUNTS)
        assert note["total_amount"] == 100.0
        with pytest.raises(HTTPException) as no_reason:
            act_on_debit_note(uuid.UUID(note["id"]), DebitNoteAction(action="VOID", expected_version=note["version"]), db, PLANT, ACCOUNTS)
        assert no_reason.value.status_code == 422
        voided = act_on_debit_note(uuid.UUID(note["id"]), DebitNoteAction(action="VOID", expected_version=note["version"], reason_code="DN-VOID-ERROR"),
                                   db, PLANT, ACCOUNTS)
        assert voided["status"] == "VOID" and voided["void_reason_code"] == "DN-VOID-ERROR"
        db.refresh(case)
        assert case.status == "OPEN"


def test_other_plant_records_are_not_found():
    with SessionLocal() as db:
        item = _item(db)
        po = _approved_po(db, item, uuid.uuid4())
        grn = _grn(db, po, quantity=50, invoice_quantity=55)
        case = _qty_case(db, grn["id"])
        note = create_debit_note(DebitNoteCreate(request_id=uuid.uuid4(), note_date=date(2026, 10, 31), discrepancy_ids=[case.id],
                                                 reason_code="DN-QTY"), db, PLANT, ACCOUNTS)
        outsider_checks = [
            lambda: get_purchase_order(po["id"], db, OTHER_PLANT, MAKER),
            lambda: purchase_order_history(po["id"], db, OTHER_PLANT, MAKER),
            lambda: short_close_purchase_order(po["id"], ShortClosePayload(expected_version=1, reason_code="PC-X"), db, OTHER_PLANT, HEAD),
            lambda: approve_purchase_order(po["id"], RevisionActionPayload(expected_version=1), db, OTHER_PLANT, CHECKER),
            lambda: get_governed_receipt(uuid.UUID(grn["id"]), db, OTHER_PLANT, MAKER),
            lambda: act_on_discrepancy(case.id, DiscrepancyAction(action="ASSIGN", expected_version=case.version, assignee="x"), db, OTHER_PLANT, CHECKER),
            lambda: act_on_debit_note(uuid.UUID(note["id"]), DebitNoteAction(action="SUBMIT", expected_version=note["version"]), db, OTHER_PLANT, ACCOUNTS),
            lambda: get_lot(uuid.uuid4(), db, OTHER_PLANT, MAKER),
        ]
        for check in outsider_checks:
            with pytest.raises(HTTPException) as refused:
                check()
            assert refused.value.status_code == 404
        # Nothing of this plant changed.
        assert get_purchase_order(po["id"], db, PLANT, MAKER)["status"] == "PARTIALLY_RECEIVED"
