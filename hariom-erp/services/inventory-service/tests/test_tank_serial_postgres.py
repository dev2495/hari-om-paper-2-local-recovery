"""The plant's glue tank number on live PostgreSQL (owner, 3 Nov 2026): ``AIT 00546``.

A running series of glue (adhesive) tanks per plant and financial year, separate from the reel series, AIT 00001
again on 1 April. Opening stock keeps a tank's own number and the next new tank continues after the highest;
PO GRN, manual GRN and the old inward give every new glue lot the next number as batch_no and amigo_no; other
bulk lots keep their numbers; the Owner / Admin sets the next number (raise only, audited); a reel and a tank
may share a number, and a typed number that is both lists both.
"""
import os
import uuid
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import ensure_runtime_schema, ensure_stock_count_and_schedule_schema
from src.database import Base, SessionLocal, engine
from src.models import ItemMaster, PaperReel, PurchaseOrderRevision, ReelSerialSetting, StockBatch
from src.routers.inward import InwardCreate, create_inward
from src.routers.labels import find_label_by_number
from src.routers.manual_receipts import ManualReceiptCreate, post_manual_receipt
from src.routers.opening_stock import PreviewLine, PreviewPayload, opening_load_labels, preview_opening_load
from src.routers.procurement import GovernedReceiptCreate, post_governed_receipt
from src.routers.purchase import PurchaseOrderCreate, RevisionActionPayload, approve_purchase_order, create_purchase_order, submit_purchase_order
from src.routers.reel_serial import ReelSerialSet, get_reel_serial, get_tank_serial, set_reel_serial, set_tank_serial
from src.routers.stock_control import OpeningLoadPayload, create_opening_load
from src.services import tank_serial
from src.services.stock_lots import resolve_lot

OWNER = {"sub": "owner@example.com", "roles": ["Owner"], "actual_roles": ["Owner"], "role": "Owner", "token": ""}
STORE = {"sub": "store@example.com", "roles": ["Store"], "actual_roles": ["Store"], "role": "Store", "token": ""}
GO_LIVE = date(2026, 11, 1)


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()
    ensure_stock_count_and_schedule_schema()


def _item(db, plant, kind="ADHESIVE", *, tracking="BULK", uom="KG", code=None):
    item = ItemMaster(item_code=code or f"{kind[:4]}-{uuid.uuid4().hex[:6]}", name=f"{kind.title()} tank test", type=kind,
                      tracking_mode=tracking, uom=uom, plant_id=plant, active="true", unit_cost=80.0)
    db.add(item)
    db.commit()
    return item


def _open(db, plant, lines, *, key=None):
    return create_opening_load(OpeningLoadPayload(effective_date=GO_LIVE, request_id=key or uuid.uuid4(), notes="Go-live", lines=lines),
                               db, plant, OWNER)


def _po(db, plant, item, uom="KG"):
    with patch("src.routers.purchase.emit_audit_event"):
        created = create_purchase_order(PurchaseOrderCreate(
            request_id=uuid.uuid4(), category="RM_PM", supplier_id=uuid.uuid4(), supplier_name="Glue works",
            expected_date=date(2026, 11, 5), lines=[{"item_id": item.id, "qty_ordered": 5000, "unit_cost": 90, "uom": uom}],
        ), db, plant, STORE)
        revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created["id"]).one()
        submitted = submit_purchase_order(created["id"], RevisionActionPayload(expected_version=created["version"], content_hash=revision.content_hash, reason="Ready"), db, plant, STORE)
        return approve_purchase_order(created["id"], RevisionActionPayload(expected_version=submitted["version"], content_hash=revision.content_hash, reason="Approved"), db, plant, OWNER)


def _po_grn(db, plant, po, qty, *, batch_no=None, on=date(2026, 11, 4)):
    return post_governed_receipt(GovernedReceiptCreate(
        request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=on, supplier_challan_no=f"CH-{uuid.uuid4().hex[:6]}",
        invoice_no=f"INV-{uuid.uuid4().hex[:6]}", invoice_date=on,
        lines=[{"po_line_id": uuid.UUID(po["lines"][0]["id"]), "quantity": qty, "invoice_rate": 90, "batch_no": batch_no}],
    ), db, plant, STORE)


def _manual_grn(db, plant, item, qty, *, batch_no=None, on=date(2026, 11, 4)):
    return post_manual_receipt(ManualReceiptCreate(
        request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Glue works", reason_code="MR-URGENT", reason_note="Local purchase",
        received_date=on, supplier_challan_no=f"DC-{uuid.uuid4().hex[:5]}", invoice_no=f"G-{uuid.uuid4().hex[:6]}", invoice_date=on,
        lines=[{"item_id": item.id, "quantity": qty, "invoice_rate": 90, "batch_no": batch_no}],
    ), db, plant, STORE)


def _lot(db, plant, receipt):
    return next(lot for lot in db.query(StockBatch).filter_by(plant_id=plant).all() if (lot.inward_metadata or {}).get("receipt_id") == str(receipt["id"]))


def _set_tank(db, plant, number, code="RN-PLANT-SERIES"):
    with patch("src.routers.reel_serial.emit_audit_event"), patch("src.routers.reel_serial.ist_today", return_value=GO_LIVE):
        return set_tank_serial(ReelSerialSet(next_number=number, reason_code=code, reason_note="Plant tank book"), db, plant, OWNER)


def test_opening_tanks_keep_their_numbers_and_the_next_new_tank_follows_the_highest():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant, code="PVA-GLUE")
        paper = _item(db, plant, "RAW_PAPER", tracking="REEL", code="351")
        # The page checks: a tank number typed any way, a repeat in the batch, and a non-glue bulk lot.
        boxes = _item(db, plant, "PACKAGING", uom="PCS", code="BOX")
        check = preview_opening_load(PreviewPayload(effective_date=GO_LIVE, lines=[
            PreviewLine(item_id=str(glue.id), qty=900, serial="ait546"),
            PreviewLine(item_id=str(glue.id), qty=900, serial="AIT 00546"),
            PreviewLine(item_id=str(boxes.id), qty=10, serial="AIT 00700"),
            PreviewLine(item_id=str(glue.id), qty=900, serial="tank 5"),
            # A reel may carry the same number: it is the other series.
            PreviewLine(item_id=str(paper.id), qty=1000, serial="AIT 00546"),
        ]), db, plant, OWNER)
        rows = check["lines"]
        assert rows[0]["ok"] and rows[0]["serial"] == "AIT 00546"
        assert rows[1]["errors"] == [{"field": "serial", "message": "AIT 00546 is also on row 1."}]
        assert rows[2]["errors"] == [{"field": "serial", "message": "Only reels, coils and glue tanks carry an AIT number."}]
        assert rows[3]["errors"] == [{"field": "serial", "message": "tank 5 is not an AIT number like AIT 00546."}]
        assert rows[4]["ok"] and rows[4]["serial"] == "AIT 00546"

        posted = _open(db, plant, [
            {"item_id": glue.id, "qty": 950, "serial": "AIT 00546", "received_on": "2026-10-20", "old_mark": "T-546"},
            {"item_id": glue.id, "qty": 880, "serial": "AIT 01000"},
            {"item_id": glue.id, "qty": 500},
            {"item_id": paper.id, "qty": 1000, "serial": "AIT 00546"},
            {"item_id": boxes.id, "qty": 40},
        ])
        numbers = [line.get("batch_no") or line.get("reel_code") for line in posted["lines"]]
        assert numbers[:4] == ["AIT 00546", "AIT 01000", "AIT 01001", "AIT 00546"]
        assert numbers[4].startswith("RM-BOX-261101-")  # other bulk lots keep their numbers
        tank = db.query(StockBatch).filter_by(plant_id=plant, batch_no="AIT 00546").one()
        meta = tank.inward_metadata
        assert (meta["amigo_no"], meta["serial_no"], meta["serial_fy"], meta["serial_kept"]) == ("AIT 00546", 546, 2026, True)
        assert meta["saved_label"]["inward_date"] == "2026-10-20"
        # The label prints the day the tank came in; a tank without one prints the go-live date.
        labels = {row["code"]: row for row in opening_load_labels(uuid.UUID(posted["id"]), db, plant, STORE)["labels"]}
        assert labels["AIT 01000"]["in_since"] == "2026-11-01"
        assert [row["in_since"] for row in opening_load_labels(uuid.UUID(posted["id"]), db, plant, STORE)["labels"]][0] == "2026-10-20"

        state = tank_serial.series_state(db, plant, GO_LIVE)
        assert (state["next_serial"], state["last_serial"]) == ("AIT 01002", "AIT 01001")
        # The reel series is untouched by the tanks.
        with patch("src.routers.reel_serial.ist_today", return_value=GO_LIVE):
            assert get_reel_serial(db, plant, STORE)["next_serial"] == "AIT 00547"

        # Taken numbers are refused at the check and at the post.
        again = preview_opening_load(PreviewPayload(effective_date=GO_LIVE, lines=[
            PreviewLine(item_id=str(glue.id), qty=100, serial="AIT 01000")]), db, plant, OWNER)
        assert again["lines"][0]["errors"] == [{"field": "serial", "message": "AIT 01000 is already a glue tank in this plant this year."}]
        with pytest.raises(HTTPException) as refused:
            _open(db, plant, [{"item_id": glue.id, "qty": 100, "serial": "AIT 01000"}])
        assert refused.value.status_code == 422
        db.rollback()

        # Goods inward carries on after the highest: PO GRN, then manual GRN.
        po = _po(db, plant, glue)
        po_lot = _lot(db, plant, _po_grn(db, plant, po, 200, batch_no="VEN-77"))
        assert (po_lot.batch_no, po_lot.inward_metadata["amigo_no"], po_lot.inward_metadata["vendor_batch_no"]) == ("AIT 01002", "AIT 01002", "VEN-77")
        assert po_lot.inward_metadata["saved_label"]["amigo_no"] == "AIT 01002"
        manual_lot = _lot(db, plant, _manual_grn(db, plant, glue, 150))
        assert (manual_lot.batch_no, manual_lot.inward_metadata["serial_no"]) == ("AIT 01003", 1003)

        # A typed number that is both a reel and a glue tank lists both; the QR picks its own.
        scope = {"scope_all": False, "selected_plant_id": plant, "allowed_plants": [plant]}
        found = find_label_by_number(code="ait 546", kind="ALL", limit=12, db=db, plant_scope=scope, current_user=STORE)
        assert found["match"] == "EXACT" and sorted(row["kind"] for row in found["rows"]) == ["LOT", "REEL"]
        scanned = find_label_by_number(code=f"HARIOM|BATCH|{plant}|{tank.id}|AIT 00546", kind="ALL", limit=12, db=db,
                                       plant_scope=scope, current_user=STORE)
        assert [row["kind"] for row in scanned["rows"]] == ["LOT"]
        with pytest.raises(HTTPException) as both:
            resolve_lot(db, plant, "AIT 00546")
        assert both.value.status_code == 409 and both.value.detail["code"] == "AMBIGUOUS_LABEL"
        assert resolve_lot(db, plant, f"HARIOM|BATCH|{plant}|{tank.id}|AIT 00546")["entity"].id == tank.id
        assert resolve_lot(db, plant, "AIT 01001")["entity_type"] == "BATCH"


def test_inward_lots_get_tank_numbers_only_for_glue_and_the_series_restarts_in_april():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant)
        boxes = _item(db, plant, "PACKAGING", uom="PCS")
        po = _po(db, plant, boxes, uom="PCS")
        box_lot = _lot(db, plant, _po_grn(db, plant, po, 100))
        assert box_lot.batch_no.endswith("-B001") and "serial_no" not in box_lot.inward_metadata
        typed = _lot(db, plant, _manual_grn(db, plant, boxes, 50, batch_no="box-9"))
        assert typed.batch_no == "BOX-9"

        march = _lot(db, plant, _manual_grn(db, plant, glue, 100, on=date(2027, 3, 31)))
        april = _lot(db, plant, _manual_grn(db, plant, glue, 100, on=date(2027, 4, 1)))
        assert march.inward_metadata["amigo_no"] == april.inward_metadata["amigo_no"] == "AIT 00001"
        # batch_no stays unique in the plant: the reused number gets the year added, like a reel_code.
        assert (march.batch_no, april.batch_no) == ("AIT 00001", "AIT 00001/27-28")
        assert (march.inward_metadata["serial_fy"], april.inward_metadata["serial_fy"]) == (2026, 2027)

        # The old inward screen (non-purchase exception) gives a glue lot the next number too.
        with patch("src.routers.inward.emit_audit_event"):
            response = create_inward(InwardCreate(item_id=glue.id, qty=75, supplier_id=uuid.uuid4(), supplier_name="Glue works",
                                                  reference_type="INTERNAL", effective_date=date(2027, 4, 2), amigo_no="OLD-5"), db, plant, STORE)
            other = create_inward(InwardCreate(item_id=boxes.id, qty=5, supplier_id=uuid.uuid4(), supplier_name="Box co",
                                               reference_type="INTERNAL", amigo_no="AMG-9"), db, plant, STORE)
        lot = db.get(StockBatch, response.batch_id)
        assert response.batch_no == "AIT 00002" and lot.inward_metadata["amigo_no"] == "AIT 00002"
        assert lot.inward_metadata["vendor_batch_no"] == "OLD-5" and response.label["amigo_no"] == "AIT 00002"
        assert other.batch_no == "AMG-9"


def test_owner_sets_the_next_tank_number_raise_only_and_the_reel_setting_is_its_own():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        glue = _item(db, plant)
        with patch("src.routers.reel_serial.ist_today", return_value=GO_LIVE):
            fresh = get_tank_serial(db, plant, STORE)
        assert fresh["next_serial"] == "AIT 00001" and fresh["kind"] == "TANK" and not fresh["can_set"]
        state = _set_tank(db, plant, 1001)
        assert state["next_serial"] == "AIT 01001" and state["history"][0]["to_number"] == 1001
        assert db.query(ReelSerialSetting).filter_by(plant_id=plant, kind="TANK").count() == 1

        lot = _lot(db, plant, _manual_grn(db, plant, glue, 100))
        assert lot.batch_no == "AIT 01001"
        with pytest.raises(HTTPException) as lower:
            _set_tank(db, plant, 900)
        assert lower.value.status_code == 409 and "never lowered" in lower.value.detail
        db.rollback()
        raised = _set_tank(db, plant, 1100, code="RN-SPOILED")
        assert raised["next_serial"] == "AIT 01100" and raised["last_serial"] == "AIT 01001" and len(raised["history"]) == 2

        # The reel setting does not see the tank changes, and setting it leaves the tanks alone.
        with patch("src.routers.reel_serial.emit_audit_event"), patch("src.routers.reel_serial.ist_today", return_value=GO_LIVE):
            reel = set_reel_serial(ReelSerialSet(next_number=6280, reason_code="RN-PLANT-SERIES", reason_note="Reel book"), db, plant, OWNER)
        assert reel["next_serial"] == "AIT 06280" and len(reel["history"]) == 1
        assert tank_serial.series_state(db, plant, GO_LIVE)["next_serial"] == "AIT 01100"
        assert db.query(PaperReel).filter_by(plant_id=uuid.UUID(plant)).count() == 0
