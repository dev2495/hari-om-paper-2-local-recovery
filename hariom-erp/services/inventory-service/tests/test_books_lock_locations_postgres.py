"""Closed months lock the store books, GRN stock lands in the RM store, and the count / calendar
schema keeps old rows valid (client 2026-10-28, live PostgreSQL)."""
import os
import uuid
from datetime import date, datetime

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.main import STOCK_COUNT_SCHEMA_STATEMENTS, ensure_runtime_schema, ensure_stock_count_and_schedule_schema
from src.database import Base, SessionLocal, engine
from src.models import (
    InventoryCertification, InventoryLocation, ItemMaster, PaperReel, PurchaseOrderRevision, StockBatch,
    StockCountEntry, StockCountLocation, StockTransaction,
)
from src.routers.books import BooksLockPayload, BooksUnlockPayload, list_books_locks, lock_books_month, unlock_books_month
from src.routers.issue import IssueCreate, create_issue
from src.routers.manual_receipts import ManualReceiptCreate, post_manual_receipt
from src.routers.procurement import GovernedReceiptCreate, post_governed_receipt
from src.routers.purchase import PurchaseOrderCreate, RevisionActionPayload, approve_purchase_order, create_purchase_order, submit_purchase_order
from src.routers.reel_issues import ReelIssueCreate, WeightIssueCreate, create_reel_issue, issue_parchment_by_weight
from src.routers.stock_control import (
    AdjustmentVoucherPayload, OpeningLoadPayload, create_adjustment_voucher, create_opening_load, post_adjustment_voucher,
)
from src.services.books import assert_books_open, closed_message, ist_today, month_label
from src.services.locations import RECEIVING_DEFAULT_CODE, default_receiving_location
from src.utils.auth import require_owner

MAKER = {"sub": "store.maker@example.com", "roles": ["Store"], "token": ""}
CHECKER = {"sub": "plant.owner@example.com", "roles": ["Owner"], "token": ""}
OWNER = {"sub": "owner@example.com", "roles": ["Owner"], "actual_roles": ["Owner"], "role": "Owner", "token": ""}
ADMIN = {"sub": "admin@example.com", "roles": ["Admin"], "actual_roles": ["Admin"], "role": "Admin", "token": ""}
SEPT_CLOSED = "September 2026 is closed. Ask the owner to re-open it."


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()
    ensure_stock_count_and_schedule_schema()


def _item(db, plant, kind, *, tracking="BULK", uom="KG"):
    item = ItemMaster(item_code=f"{kind[:4]}-{uuid.uuid4().hex[:8]}", name=f"{kind.title()} test", type=kind,
                      tracking_mode=tracking, uom=uom, plant_id=plant, active="true",
                      quality_profile={"status": "approved", "revision": 1, "parameters": [{"code": "gsm", "min": 200, "max": 260}]})
    db.add(item)
    db.commit()
    return item


def _po(db, plant, lines):
    created = create_purchase_order(PurchaseOrderCreate(
        request_id=uuid.uuid4(), category="RM_PM", supplier_id=uuid.uuid4(), supplier_name="Books mill",
        expected_date=date(2026, 10, 30), lines=lines,
    ), db, plant, MAKER)
    revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created["id"]).one()
    submitted = submit_purchase_order(created["id"], RevisionActionPayload(expected_version=created["version"], content_hash=revision.content_hash, reason="Ready"), db, plant, MAKER)
    return approve_purchase_order(created["id"], RevisionActionPayload(expected_version=submitted["version"], content_hash=revision.content_hash, reason="Approved"), db, plant, CHECKER)


def _receipt(po, lines, on):
    return GovernedReceiptCreate(request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=on,
                                 supplier_challan_no=f"CH-{uuid.uuid4().hex[:6]}", invoice_no=f"INV-{uuid.uuid4().hex[:6]}",
                                 invoice_date=on, lines=lines)


def _reel_line(po, kg, location_id=None, line_location_id=None):
    lot = {"source_reel_no": f"R-{uuid.uuid4().hex[:6]}", "net_weight_kg": kg, "width_mm": 900, "physical_form": "REEL"}
    if location_id:
        lot["location_id"] = location_id
    row = {"po_line_id": uuid.UUID(po["lines"][0]["id"]), "invoice_rate": 30, "lots": [lot]}
    if line_location_id:
        row["location_id"] = line_location_id
    return row


def _registered_at(moment: datetime):
    """Freeze the clock floor issues are dated by (naive UTC)."""
    from unittest.mock import patch

    return patch("src.services.shift_rule._utc_now", return_value=moment)


def _refused(call, message=SEPT_CLOSED):
    """Every closed-month refusal is the same 409 body in inventory, production and the BFF."""
    with pytest.raises(HTTPException) as error:
        call()
    assert error.value.status_code == 409, error.value.detail
    assert error.value.detail["code"] == "BOOKS_LOCKED" and error.value.detail["message"] == message


def test_month_names_and_messages():
    assert month_label(date(2026, 10, 1)) == "October 2026"
    assert closed_message(date(2026, 10, 9)) == "October 2026 is closed. Ask the owner to re-open it."


def test_only_the_owner_locks_and_only_closed_months_refuse_store_movements():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        with pytest.raises(HTTPException) as denied:
            require_owner(ADMIN)
        assert denied.value.status_code == 403 and denied.value.detail == "Only the Owner can do this."
        with pytest.raises(HTTPException) as running:
            lock_books_month(BooksLockPayload(month="2099-01"), db, plant, OWNER)
        assert running.value.status_code == 409 and "still running" in running.value.detail

        first = lock_books_month(BooksLockPayload(month="2026-09", note="Month-end close"), db, plant, OWNER)
        again = lock_books_month(BooksLockPayload(month="2026-09"), db, plant, OWNER)
        assert first["status"] == "LOCKED" and again["id"] == first["id"] and len(again["history"]) == 1
        assert list_books_locks(db, {"scope_all": False, "selected_plant_id": plant}, OWNER)["locked_months"] == ["2026-09"]

        # Exactly September is locked: October and the never-closed August stay open (spec 2.5).
        _refused(lambda: assert_books_open(db, plant, date(2026, 9, 30)))
        assert_books_open(db, plant, date(2026, 8, 31))
        assert list_books_locks(db, {"scope_all": False, "selected_plant_id": plant}, OWNER)["locked_months"] == ["2026-09"]
        assert_books_open(db, plant, date(2026, 10, 1))
        # A naive UTC timestamp counts on its IST day: 30 Sep 19:00 UTC is already 1 Oct in India.
        assert_books_open(db, plant, datetime(2026, 9, 30, 19, 0))
        _refused(lambda: assert_books_open(db, plant, datetime(2026, 9, 30, 18, 0)))

        paper = _item(db, plant, "RAW_PAPER", tracking="REEL")
        adhesive = _item(db, plant, "ADHESIVE")
        parchment = _item(db, plant, "PARCHMENT", tracking="REEL")
        po = _po(db, plant, [{"item_id": paper.id, "qty_ordered": 5000, "unit_cost": 30, "uom": "KG"}])
        _refused(lambda: post_governed_receipt(_receipt(po, [_reel_line(po, 500)], date(2026, 9, 15)), db, plant, MAKER))
        db.rollback()
        october = post_governed_receipt(_receipt(po, [_reel_line(po, 500)], date(2026, 10, 15)), db, plant, MAKER)
        reel_id = uuid.UUID(october["lots"][0]["id"])
        _refused(lambda: post_manual_receipt(ManualReceiptCreate(
            request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Glue works", reason="Local purchase",
            received_date=date(2026, 9, 10), supplier_challan_no="DC 1", invoice_pending=True,
            lines=[{"item_id": adhesive.id, "quantity": 50}],
        ), db, plant, MAKER))
        db.rollback()
        # Floor issues take their business date from the moment they are registered (client 2026-10-30):
        # registered on a September day, they are refused.
        with _registered_at(datetime(2026, 9, 20, 6, 0)):
            _refused(lambda: create_issue(IssueCreate(item_id=adhesive.id, qty=5, shift="A", effective_date=date(2026, 9, 20)), db, plant, MAKER))
        db.rollback()
        with _registered_at(datetime(2026, 9, 30, 6, 0)):
            _refused(lambda: create_reel_issue(ReelIssueCreate(reel_id=reel_id, shift="A", issue_date=date(2026, 9, 30)), db, plant, MAKER))
        db.rollback()
        with _registered_at(datetime(2026, 9, 2, 6, 0)):
            _refused(lambda: issue_parchment_by_weight(WeightIssueCreate(item_id=parchment.id, qty_kg=5, shift="A", issue_date=date(2026, 9, 2)), db, plant, MAKER))
        db.rollback()
        line = {"item_id": adhesive.id, "qty_delta": 2}  # a lot-less line may only add (a new lot on QC hold)
        _refused(lambda: create_adjustment_voucher(AdjustmentVoucherPayload(effective_date=date(2026, 9, 30), reason_code="COUNT_SHORT", post_now=True, lines=[line]), db, plant, MAKER))
        db.rollback()
        draft = create_adjustment_voucher(AdjustmentVoucherPayload(effective_date=date(2026, 9, 30), reason_code="COUNT_SHORT", lines=[line]), db, plant, MAKER)
        assert draft["status"] == "DRAFT"
        # The Owner approves a waiting correction today: it is dated today (open), never back in closed September.
        posted = post_adjustment_voucher(uuid.UUID(draft["id"]), db, plant, OWNER)
        assert posted["status"] == "POSTED" and posted["effective_date"] == ist_today().isoformat()
        _refused(lambda: create_opening_load(OpeningLoadPayload(effective_date=date(2026, 9, 1), lines=[{"item_id": adhesive.id, "qty": 10}]), db, plant, OWNER))
        db.rollback()

        with pytest.raises(ValidationError):
            BooksUnlockPayload(month="2026-09", reason="  ")
        reopened = unlock_books_month(BooksUnlockPayload(month="2026-09", reason="Late GRN found"), db, plant, OWNER)
        assert reopened["status"] == "UNLOCKED" and reopened["unlock_reason"] == "Late GRN found"
        assert [event["action"] for event in reopened["history"]] == ["LOCKED", "UNLOCKED"]
        assert_books_open(db, plant, date(2026, 9, 30))
        assert_books_open(db, plant, date(2026, 8, 31))
        assert unlock_books_month(BooksUnlockPayload(month="2026-07", reason="Never closed"), db, plant, OWNER)["status"] == "OPEN"
        september = post_governed_receipt(_receipt(po, [_reel_line(po, 300)], date(2026, 9, 15)), db, plant, MAKER)
        assert september["grn_no"]


def test_an_open_month_before_a_closed_month_stays_open():
    """August and September closed, July never had activity: July stays open for GRN and issues (exactly the
    closed months are locked, the same rule production and the BFF use); August refuses."""
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        lock_books_month(BooksLockPayload(month="2026-08"), db, plant, OWNER)
        lock_books_month(BooksLockPayload(month="2026-09"), db, plant, OWNER)
        adhesive = _item(db, plant, "ADHESIVE")
        posted = post_manual_receipt(ManualReceiptCreate(
            request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Glue works", reason="Local purchase",
            received_date=date(2026, 7, 20), supplier_challan_no="DC 7", invoice_pending=True,
            lines=[{"item_id": adhesive.id, "quantity": 5}],
        ), db, plant, MAKER)
        assert posted  # the GRN lot waits for incoming QC, so a July issue is checked at the books guard itself
        assert_books_open(db, plant, date(2026, 7, 25))
        _refused(lambda: assert_books_open(db, plant, date(2026, 8, 3)), "August 2026 is closed. Ask the owner to re-open it.")
        with _registered_at(datetime(2026, 8, 25, 6, 0)):
            _refused(lambda: create_issue(IssueCreate(item_id=adhesive.id, qty=1, shift="A", effective_date=date(2026, 8, 25)), db, plant, MAKER),
                     "August 2026 is closed. Ask the owner to re-open it.")
        db.rollback()
        assert_books_open(db, plant, date(2026, 10, 1))
        unlock_books_month(BooksUnlockPayload(month="2026-09", reason="Late bill"), db, plant, OWNER)
        _refused(lambda: assert_books_open(db, plant, date(2026, 8, 25)), "August 2026 is closed. Ask the owner to re-open it.")
        assert_books_open(db, plant, date(2026, 9, 25))


def test_books_locks_list_is_scoped_to_allowed_plants():
    plant, other = str(uuid.uuid4()), str(uuid.uuid4())
    with SessionLocal() as db:
        lock_books_month(BooksLockPayload(month="2026-08"), db, plant, OWNER)
        lock_books_month(BooksLockPayload(month="2026-07"), db, other, OWNER)
        assert list_books_locks(db, {"scope_all": True, "allowed_plants": []}, OWNER) == {"plant_id": None, "locked_months": [], "items": []}
        mine = list_books_locks(db, {"scope_all": True, "allowed_plants": [plant]}, OWNER)
        assert mine["locked_months"] == ["2026-08"] and {row["plant_id"] for row in mine["items"]} == {plant}


def test_grn_without_a_location_goes_to_the_rm_store():
    plant = str(uuid.uuid4())
    other_plant = str(uuid.uuid4())
    with SessionLocal() as db:
        paper = _item(db, plant, "RAW_PAPER", tracking="REEL")
        adhesive = _item(db, plant, "ADHESIVE")
        po = _po(db, plant, [{"item_id": paper.id, "qty_ordered": 5000, "unit_cost": 30, "uom": "KG"},
                             {"item_id": adhesive.id, "qty_ordered": 500, "unit_cost": 90, "uom": "KG"}])
        posted = post_governed_receipt(_receipt(po, [
            _reel_line(po, 400),
            {"po_line_id": uuid.UUID(po["lines"][1]["id"]), "quantity": 100, "invoice_rate": 90},
        ], date(2026, 10, 20)), db, plant, MAKER)
        store = db.query(InventoryLocation).filter_by(plant_id=plant, code=RECEIVING_DEFAULT_CODE).one()
        assert store.name == "RM store" and store.is_receiving_default and store.purpose == "STORAGE" and store.active == "true"
        reel = db.get(PaperReel, uuid.UUID(posted["lots"][0]["id"]))
        batch = db.query(StockBatch).filter_by(item_id=adhesive.id).one()
        assert reel.location_id == store.id and batch.location_id == store.id
        assert db.query(StockTransaction).filter_by(batch_id=batch.id).one().location_id == store.id
        assert default_receiving_location(db, plant).id == store.id

        # A chosen rack wins; the line's rack is used for its reels when a reel has none.
        rack = InventoryLocation(plant_id=plant, code="RM-A-09", name="Paper rack A9", warehouse="RAW MATERIAL STORE", purpose="STORAGE")
        foreign = InventoryLocation(plant_id=other_plant, code="RM-X-01", warehouse="RAW MATERIAL STORE", purpose="STORAGE")
        closed = InventoryLocation(plant_id=plant, code="RM-OLD", warehouse="RAW MATERIAL STORE", purpose="STORAGE", active="false")
        db.add_all([rack, foreign, closed])
        db.commit()
        on_rack = post_governed_receipt(_receipt(po, [_reel_line(po, 300, line_location_id=rack.id)], date(2026, 10, 21)), db, plant, MAKER)
        assert db.get(PaperReel, uuid.UUID(on_rack["lots"][0]["id"])).location_id == rack.id
        for bad in (foreign.id, closed.id):
            with pytest.raises(HTTPException) as refused:
                post_governed_receipt(_receipt(po, [_reel_line(po, 200, location_id=bad)], date(2026, 10, 22)), db, plant, MAKER)
            assert refused.value.status_code == 422 and "active location of this plant" in refused.value.detail
            db.rollback()

        manual = post_manual_receipt(ManualReceiptCreate(
            request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Glue works", reason="Local purchase",
            received_date=date(2026, 10, 23), supplier_challan_no="DC 7", invoice_pending=True,
            lines=[{"item_id": adhesive.id, "quantity": 40}],
        ), db, plant, MAKER)
        manual_batch = db.query(StockBatch).filter(StockBatch.item_id == adhesive.id, StockBatch.id != batch.id).one()
        assert manual["grn_no"] and manual_batch.location_id == store.id


def test_an_existing_rm_store_becomes_the_default_and_only_one_default_per_plant():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        existing = InventoryLocation(plant_id=plant, code=RECEIVING_DEFAULT_CODE, warehouse="RAW MATERIAL STORE", purpose="STORAGE")
        db.add(existing)
        db.commit()
        assert default_receiving_location(db, plant).id == existing.id
        db.commit()
        assert existing.is_receiving_default and existing.name == "RM store"
        db.add(InventoryLocation(plant_id=plant, code="RM-2", warehouse="X", purpose="STORAGE", is_receiving_default=True))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_one_month_end_count_per_month_and_spot_counts_share_dates():
    plant = str(uuid.uuid4())
    with SessionLocal() as db:
        def count(kind, status="DRAFT", month=None):
            row = InventoryCertification(plant_id=plant, period_start=date(2026, 10, 1), period_end=date(2026, 10, 31),
                                         kind=kind, month=month, status=status, created_by="store@example.com")
            db.add(row)
            db.commit()
            return row

        first = count("MONTH_END", month=date(2026, 10, 1))
        count("SPOT")
        count("SPOT")
        assert first.scope_location_ids == [] and first.scope_item_ids == []
        with pytest.raises(IntegrityError):
            count("MONTH_END", month=date(2026, 10, 1))
        db.rollback()
        with pytest.raises(IntegrityError):
            count("MONTH_END")  # a month-end count names its month
        db.rollback()
        first.status = "CANCELLED"
        db.commit()
        again = count("MONTH_END", month=date(2026, 10, 1))

        item = _item(db, plant, "ADHESIVE")
        rack = InventoryLocation(plant_id=plant, code="RM-C-01", warehouse="RAW MATERIAL STORE", purpose="STORAGE")
        db.add(rack)
        db.commit()
        db.add_all([
            StockCountLocation(count_id=again.id, plant_id=plant, location_id=rack.id),
            StockCountLocation(count_id=again.id, plant_id=plant, bucket="UNASSIGNED"),
        ])
        db.commit()
        db.add(StockCountLocation(count_id=again.id, plant_id=plant, bucket="UNASSIGNED"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        entry = StockCountEntry(count_id=again.id, plant_id=plant, entity_type="LOOSE", item_id=item.id, uom="KG",
                                location_id=rack.id, expected_qty=0, counted_qty=12.5, variance_qty=12.5, status="EXTRA",
                                counted_by="helper@example.com", counted_at=datetime.utcnow(), client_ref="scan-1")
        db.add(entry)
        db.commit()
        db.add(StockCountEntry(count_id=again.id, plant_id=plant, entity_type="LOOSE", item_id=item.id, client_ref="scan-1"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_old_rows_are_backfilled_once():
    """The startup statements turn legacy rows into counts, PO sources and arrivals (in a rolled-back transaction)."""
    plant = str(uuid.uuid4())
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            for table, column in (("inventory_certifications", "kind"), ("purchase_orders", "source"),
                                  ("procurement_plan_entries", "approval_status"), ("procurement_plan_entries", "source")):
                connection.execute(text(f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL"))

            def cert(start, end, status, created):
                row_id = uuid.uuid4()
                connection.execute(text(
                    "INSERT INTO inventory_certifications (id, plant_id, period_start, period_end, status, count_state, attachment_refs, "
                    "created_by, certified_by, certified_at, created_at, kind) VALUES (:id, :plant, :start, :end, :status, 'DRAFT', '[]', "
                    "'store@example.com', :certified_by, :certified_at, :created, NULL)"),
                    {"id": row_id, "plant": plant, "start": start, "end": end, "status": status, "created": created,
                     "certified_by": "owner@example.com" if status == "CERTIFIED" else None,
                     "certified_at": created if status == "CERTIFIED" else None})
                return row_id

            october_certified = cert(date(2026, 10, 1), date(2026, 10, 31), "CERTIFIED", datetime(2026, 11, 2))
            october_redraft = cert(date(2026, 10, 1), date(2026, 10, 31), "DRAFT", datetime(2026, 11, 5))
            mid_month = cert(date(2026, 10, 5), date(2026, 10, 20), "DRAFT", datetime(2026, 10, 20))
            september = cert(date(2026, 9, 1), date(2026, 9, 30), "DRAFT", datetime(2026, 10, 1))
            august = cert(date(2026, 8, 1), date(2026, 8, 31), "CARRIED_FORWARD", datetime(2026, 9, 2))
            rack_count = cert(date(2026, 7, 1), date(2026, 7, 31), "DRAFT", datetime(2026, 7, 28))

            def po(metadata):
                row_id = uuid.uuid4()
                connection.execute(text(
                    "INSERT INTO purchase_orders (id, plant_id, po_no, category, current_revision_no, version, supplier_id, "
                    "supplier_name_snapshot, status, created_by, approved_by, metadata_json, source) VALUES (:id, :plant, :no, 'RM_PM', 1, 1, "
                    ":supplier, 'Mill', 'APPROVED', 'store@example.com', 'owner@example.com', :meta, NULL)"),
                    {"id": row_id, "plant": plant, "no": f"T-{uuid.uuid4().hex[:6]}", "supplier": uuid.uuid4(), "meta": metadata})
                return row_id

            plan_po = po('{"source_plan_id": "8a7f0d6e-0000-4000-8000-000000000001"}')
            requisition_po = po('{"requisition_id": "8a7f0d6e-0000-4000-8000-000000000002"}')
            manual_po = po('{"requisition_id": null, "po_date": "2026-10-03"}')

            item_id = uuid.uuid4()
            connection.execute(text(
                "INSERT INTO item_master (id, item_code, name, type, tracking_mode, uom, plant_id, active, reorder_level, "
                "safety_stock, lead_time_days) VALUES (:id, :code, 'Backfill paper', 'RAW_PAPER', 'REEL', 'KG', :plant, 'true', 0, 0, 0)"),
                {"id": item_id, "code": f"BF-{uuid.uuid4().hex[:6]}", "plant": plant})
            plan_id = uuid.uuid4()
            connection.execute(text(
                "INSERT INTO procurement_plans (id, plant_id, month, request_id, request_fingerprint, name, status, target_mode, "
                "working_calendar, version, created_by, created_at, updated_at) VALUES (:id, :plant, '2026-10-01', :request, 'x', "
                "'RM Schedule 2026-10', 'APPROVED', 'ARRIVAL', '{}', 1, 'planner@example.com', now(), now())"),
                {"id": plan_id, "plant": plant, "request": uuid.uuid4()})

            def entry(converted):
                row_id = uuid.uuid4()
                connection.execute(text(
                    "INSERT INTO procurement_plan_entries (id, plan_id, entry_date, item_id, material_form, qty_kg, status, "
                    "converted_qty_kg, created_at, approval_status, source) VALUES (:id, :plan, '2026-10-20', :item, 'REEL', 1000, "
                    "'PLANNED', :converted, now(), NULL, NULL)"),
                    {"id": row_id, "plan": plan_id, "item": item_id, "converted": converted})
                return row_id

            converted_entry = entry(1000)
            open_entry = entry(0)

            for statement in STOCK_COUNT_SCHEMA_STATEMENTS:
                connection.execute(text(statement))

            kinds = dict(connection.execute(text(
                "SELECT id, kind || ':' || COALESCE(month::text, '-') FROM inventory_certifications WHERE plant_id = :plant"),
                {"plant": plant}).all())
            # An uncertified whole-month sheet stays SPOT (as MONTH_END it could never be approved or cancelled).
            assert kinds == {october_certified: "MONTH_END:2026-10-01", october_redraft: "SPOT:-",
                             mid_month: "SPOT:-", september: "SPOT:-", august: "MONTH_END:2026-08-01",
                             rack_count: "SPOT:-"}
            # Repair of the first backfill: an old DRAFT sheet already marked MONTH_END goes back to SPOT, a
            # rack count (it has rack rows) keeps its kind.
            connection.execute(text("UPDATE inventory_certifications SET kind = 'MONTH_END', month = '2026-09-01' WHERE id = :id"), {"id": september})
            connection.execute(text("UPDATE inventory_certifications SET kind = 'MONTH_END', month = '2026-07-01' WHERE id = :id"), {"id": rack_count})
            connection.execute(text(
                "INSERT INTO stock_count_locations (id, count_id, plant_id, bucket, status, created_at, updated_at) "
                "VALUES (:id, :count, :plant, 'UNASSIGNED', 'TODO', now(), now())"),
                {"id": uuid.uuid4(), "count": rack_count, "plant": plant})
            for statement in STOCK_COUNT_SCHEMA_STATEMENTS:
                connection.execute(text(statement))
            repaired = dict(connection.execute(text(
                "SELECT id, kind || ':' || COALESCE(month::text, '-') FROM inventory_certifications WHERE id IN (:a, :b)"),
                {"a": september, "b": rack_count}).all())
            assert repaired == {september: "SPOT:-", rack_count: "MONTH_END:2026-07-01"}
            approved_by = connection.execute(text("SELECT approved_by FROM inventory_certifications WHERE id = :id"),
                                             {"id": october_certified}).scalar()
            assert approved_by == "owner@example.com"
            sources = dict(connection.execute(text(
                "SELECT id, source || ':' || COALESCE(approval_source, '-') FROM purchase_orders WHERE plant_id = :plant"),
                {"plant": plant}).all())
            assert sources == {plan_po: "PLAN:OWNER", requisition_po: "REQUISITION:OWNER", manual_po: "MANUAL:OWNER"}
            entries = {row[0]: row[1:] for row in connection.execute(text(
                "SELECT id, approval_status, source, proposed_by FROM procurement_plan_entries WHERE plan_id = :plan"),
                {"plan": plan_id}).all()}
            assert entries == {converted_entry: ("ON_PO", "MANUAL", "planner@example.com"),
                               open_entry: ("PROPOSED", "MANUAL", "planner@example.com")}
            # Running them again changes nothing (restart).
            for statement in STOCK_COUNT_SCHEMA_STATEMENTS:
                connection.execute(text(statement))
            assert connection.execute(text(
                "SELECT count(*) FROM inventory_certifications WHERE plant_id = :plant AND kind = 'MONTH_END'"),
                {"plant": plant}).scalar() == 3  # October, August and the rack count
        finally:
            transaction.rollback()
