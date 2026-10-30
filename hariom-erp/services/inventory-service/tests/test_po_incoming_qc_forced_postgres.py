"""C2 (client 2026-10-30): no "Incoming QC required" tick on PO lines. The server stores true on every
create and revision, whatever is sent, and an old PO line saved false still gets incoming QC at GRN
(live PostgreSQL)."""
import os
import uuid
from datetime import date

import pytest

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema
from src.database import Base, SessionLocal, engine
from src.models import ItemMaster, PurchaseOrder, PurchaseOrderLine, PurchaseOrderRevision, StockBatch
from src.routers.procurement import GovernedReceiptCreate, post_governed_receipt
from src.routers.purchase import (
    PurchaseOrderCreate, PurchaseRevisionCreate, RevisionActionPayload, _serialize_order, approve_purchase_order,
    create_purchase_order, create_purchase_order_revision, submit_purchase_order,
)

PLANT = str(uuid.uuid4())
MAKER = {"sub": "store.maker@example.com", "roles": ["Store"], "token": ""}
CHECKER = {"sub": "plant.owner@example.com", "roles": ["Owner"], "token": ""}


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()


def _item(db):
    item = ItemMaster(item_code=f"ADH-{uuid.uuid4().hex[:8]}", name="Adhesive QC test", type="ADHESIVE", tracking_mode="BULK", uom="KG",
                      plant_id=PLANT, active="true",
                      quality_profile={"status": "approved", "revision": 1, "parameters": [{"code": "viscosity", "min": 1, "max": 9}]})
    db.add(item)
    db.commit()
    return item


def _approve(db, created):
    revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created["id"]).order_by(PurchaseOrderRevision.revision_no.desc()).first()
    submitted = submit_purchase_order(created["id"], RevisionActionPayload(expected_version=created["version"], content_hash=revision.content_hash, reason="Ready"), db, PLANT, MAKER)
    return approve_purchase_order(created["id"], RevisionActionPayload(expected_version=submitted["version"], content_hash=revision.content_hash, reason="Approved"), db, PLANT, CHECKER)


def test_create_and_revise_store_incoming_qc_true_whatever_is_sent():
    with SessionLocal() as db:
        item = _item(db)
        header = dict(category="RM_PM", supplier_id=uuid.uuid4(), supplier_name="QC mill", expected_date=date(2026, 11, 5))
        created = create_purchase_order(PurchaseOrderCreate(request_id=uuid.uuid4(), **header, lines=[
            {"item_id": item.id, "qty_ordered": 100, "unit_cost": 20, "uom": "KG", "incoming_qc_required": False}]), db, PLANT, MAKER)
        assert all(line["incoming_qc_required"] is True for line in created["lines"])
        assert db.query(PurchaseOrderLine).filter_by(purchase_order_id=created["id"]).one().incoming_qc_required is True
        line = created["lines"][0]
        revised = create_purchase_order_revision(created["id"], PurchaseRevisionCreate(
            request_id=uuid.uuid4(), **header, change_reason="More quantity", expected_version=created["version"], lines=[
                {"item_id": item.id, "logical_line_id": line["logical_line_id"], "qty_ordered": 120, "unit_cost": 20, "uom": "KG", "incoming_qc_required": False},
                {"item_id": item.id, "qty_ordered": 10, "unit_cost": 20, "uom": "KG", "incoming_qc_required": False}]), db, PLANT, MAKER)
        stored = db.query(PurchaseOrderLine).filter_by(purchase_order_id=created["id"]).all()
        assert len(stored) == 2 and all(row.incoming_qc_required is True for row in stored)
        assert all(row["incoming_qc_required"] is True for row in revised["lines"])


def test_an_old_line_saved_false_reads_true_and_its_grn_waits_for_incoming_qc():
    with SessionLocal() as db:
        item = _item(db)
        created = create_purchase_order(PurchaseOrderCreate(request_id=uuid.uuid4(), category="RM_PM", supplier_id=uuid.uuid4(), supplier_name="Old mill",
            expected_date=date(2026, 11, 5), lines=[{"item_id": item.id, "qty_ordered": 50, "unit_cost": 20, "uom": "KG"}]), db, PLANT, MAKER)
        po = _approve(db, created)
        # A PO saved before 30 Oct 2026 with the tick cleared.
        db.query(PurchaseOrderLine).filter_by(purchase_order_id=po["id"]).update({"incoming_qc_required": False})
        db.commit()
        order = db.query(PurchaseOrder).filter_by(id=po["id"]).one()
        assert _serialize_order(order)["lines"][0]["incoming_qc_required"] is True
        grn = post_governed_receipt(GovernedReceiptCreate(
            request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=date(2026, 10, 30), supplier_challan_no=f"CH-{uuid.uuid4().hex[:6]}",
            invoice_no=f"INV-{uuid.uuid4().hex[:6]}", invoice_date=date(2026, 10, 30),
            lines=[{"po_line_id": uuid.UUID(po["lines"][0]["id"]), "invoice_rate": 20, "quantity": 50}]), db, PLANT, MAKER)
        assert grn["grn_no"]
        batches = db.query(StockBatch).filter(StockBatch.item_id == item.id).all()
        # Incoming QC is the only gate for issue: the lot waits on QC hold, as for any PO line.
        assert batches and all(batch.stock_status == "QC_HOLD" for batch in batches)
