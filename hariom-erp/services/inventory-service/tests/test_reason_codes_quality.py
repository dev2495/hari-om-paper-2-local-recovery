"""Quality reasons pick a code from Masters › Reason codes (owner decision 4, 1 Nov 2026).

Customer complaints are checked strictly against CUSTOMER_COMPLAINT (CC-OTHER needs a note), an incoming
concession needs a CONCESSION code and returning a rejected lot to the supplier needs an RM_ISSUE code.
Storage of the label is covered on PostgreSQL by test_customer_return_postgres.py and
test_rejected_lot_return_postgres.py; these tests check the refusals without a database.
"""
import uuid
from types import SimpleNamespace

from _reason_fakes import PLANT, FakeDB, refused, spy_on
from src.models import InventoryQualityConcession, InventoryQualityInspection, ItemMaster, ItemType
from src.routers import quality

STORE = {"sub": "store@hariom.com", "roles": ["Store"], "token": "t"}
HEAD = {"sub": "head@hariom.com", "roles": ["PlantManager"], "token": "t"}


def _complaint(**extra):
    return quality.CustomerRejectionCreate(item_id=uuid.uuid4(), rejected_qty=5, customer_name="Acme", **extra)


def test_complaint_code_is_checked_against_the_master(monkeypatch):
    spy = spy_on(monkeypatch, quality)
    item = SimpleNamespace(id=uuid.uuid4(), type=ItemType.FINISHED_GOOD)
    db = FakeDB({ItemMaster: [item]})
    refused(lambda: quality.create_customer_rejection(_complaint(reason_code="BAD-CUSTOMER-REJECT"), db, PLANT, STORE),
            422, "not in the CUSTOMER_COMPLAINT list")
    refused(lambda: quality.create_customer_rejection(_complaint(reason_code="CC-OTHER", reason_notes="bad"), db, PLANT, STORE), 422, "at least 5")
    assert spy.categories == ["CUSTOMER_COMPLAINT", "CUSTOMER_COMPLAINT"]
    assert db.commits == 0


def test_concession_needs_a_concession_code(monkeypatch):
    spy = spy_on(monkeypatch, quality)
    inspection = SimpleNamespace(id=uuid.uuid4(), plant_id=PLANT, status="FAIL", created_by="qc@hariom.com", evaluation={},
                                 entity_type="REEL", entity_id=uuid.uuid4())
    db = FakeDB({InventoryQualityInspection: [inspection], InventoryQualityConcession: []})
    refused(lambda: quality.create_quality_concession(quality.QualityConcessionCreate(inspection_id=inspection.id, reason="Urgent, no other stock"),
                                                      db, PLANT, HEAD), 422, "the concession")
    refused(lambda: quality.create_quality_concession(quality.QualityConcessionCreate(inspection_id=inspection.id, reason_code="CN-OTHER", reason_note="ok"),
                                                      db, PLANT, HEAD), 422, "at least 5")
    assert spy.categories == ["CONCESSION", "CONCESSION"] and db.commits == 0


def test_supplier_return_needs_an_rm_issue_code(monkeypatch):
    spy = spy_on(monkeypatch, quality)
    refused(lambda: quality.return_rejected_lot_to_supplier(quality.SupplierReturnCreate(entity_type="REEL", entity_id=uuid.uuid4(), reason="GSM low"),
                                                            FakeDB(), PLANT, STORE), 422, "returning this lot")
    refused(lambda: quality.return_rejected_lot_to_supplier(quality.SupplierReturnCreate(entity_type="REEL", entity_id=uuid.uuid4(), reason_code="RM-OTHER"),
                                                            FakeDB(), PLANT, STORE), 422, "at least 5")
    # With a valid code the check passes and the lot lookup runs (404 here: no such reel).
    refused(lambda: quality.return_rejected_lot_to_supplier(quality.SupplierReturnCreate(entity_type="BATCH", entity_id=uuid.uuid4(), reason_code="RM-GSM"),
                                                            FakeDB(), PLANT, STORE), 404)
    assert spy.categories == ["RM_ISSUE"] * 3
