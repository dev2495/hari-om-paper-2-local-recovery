"""RM inward calendar (spec 3) against an isolated PostgreSQL DB: propose → Owner approval →
vendor-week DRAFT POs with the approved hash → send unchanged (approved on schedule) or changed
(needs the Owner) → vendor confirmation → GRN fills the row → the calendar shows it received."""
import asyncio
import os
import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.database import Base, SessionLocal, engine
from src.main import ensure_runtime_schema, ensure_stock_count_and_schedule_schema
from src.models import (
    ItemMaster,
    PlanConversion,
    ProcurementPlan,
    ProcurementPlanEntry,
    PurchaseApprovalDecision,
    PurchaseLineSchedule,
    PurchaseOrder,
    PurchaseOrderRevision,
)
from src.routers.procurement import (
    CalendarApprove,
    CalendarEntriesCreate,
    CalendarEntryCancel,
    CalendarEntryUpdate,
    GovernedReceiptCreate,
    calendar_approve,
    calendar_cancel,
    calendar_propose,
    calendar_supply,
    calendar_update,
    calendar_expected_arrivals,
    post_governed_receipt,
)
from src.routers.purchase import (
    PurchaseOrderCreate,
    reject_purchase_order,
    PurchaseRevisionCreate,
    RevisionActionPayload,
    SendToVendorPayload,
    VendorConfirmPayload,
    approve_purchase_order,
    create_purchase_order,
    create_purchase_order_revision,
    get_purchase_order,
    list_purchase_orders,
    purchase_order_pdf,
    send_purchase_order,
    submit_purchase_order,
    vendor_confirm_purchase_order,
)
from src.services.books import ist_today
from src.services.rm_calendar import iso_week_start, schedule_hash
from src.utils.auth import require_owner

PLANT = str(uuid.uuid4())
PLANNER = {"sub": "planner.rm@example.com", "roles": ["Planner"], "actual_roles": ["Planner"], "role": "Planner", "token": ""}
STORE = {"sub": "store.rm@example.com", "roles": ["Store"], "actual_roles": ["Store"], "role": "Store", "token": ""}
OWNER = {"sub": "owner.rm@example.com", "roles": ["Owner"], "actual_roles": ["Owner"], "role": "Owner", "token": ""}
OWNER2 = {"sub": "owner2.rm@example.com", "roles": ["Owner"], "actual_roles": ["Owner"], "role": "Owner", "token": ""}
ADMIN = {"sub": "admin.rm@example.com", "roles": ["Admin"], "actual_roles": ["Admin"], "role": "Admin", "token": ""}
VENDOR_A, VENDOR_B = uuid.uuid4(), uuid.uuid4()


def setup_module() -> None:
    Base.metadata.create_all(engine)
    ensure_runtime_schema()
    ensure_stock_count_and_schedule_schema()


def _item(db, code, item_type="RAW_PAPER", uom="KG", tracking="REEL"):
    row = db.query(ItemMaster).filter_by(item_code=code, plant_id=PLANT).first()
    if row is None:
        row = ItemMaster(item_code=code, name=f"{code} material", type=item_type, tracking_mode=tracking, uom=uom, plant_id=PLANT, active="true", unit_cost=0)
        db.add(row)
        db.commit()
    return row


def _days():
    monday = iso_week_start(ist_today()) + timedelta(days=7)
    return monday, monday + timedelta(days=1), monday + timedelta(days=2), monday + timedelta(days=8)


def _propose(db, rows, user=PLANNER):
    return calendar_propose(CalendarEntriesCreate(entries=rows), db, PLANT, user)["items"]


def _approve(db, ids, request_id=None, user=OWNER, details=None):
    return calendar_approve(CalendarApprove(request_id=request_id or uuid.uuid4(), entry_ids=ids, vendor_details=details or {}), db, PLANT, user)


def _approved_po(db, vendor, name, item, qty, rate, day):
    """A hand-made PO the Owner approved: its rate is the vendor's last approved rate."""
    created = create_purchase_order(PurchaseOrderCreate(request_id=uuid.uuid4(), supplier_id=vendor, supplier_name=name,
        expected_date=day, lines=[{"item_id": item.id, "qty_ordered": qty, "unit_cost": rate, "uom": item.uom.value if hasattr(item.uom, "value") else item.uom}]), db, PLANT, STORE)
    submitted = submit_purchase_order(created["id"], RevisionActionPayload(expected_version=created["version"]), db, PLANT, STORE)
    approve_purchase_order(created["id"], RevisionActionPayload(expected_version=submitted["version"]), db, PLANT, OWNER)
    return created


def test_only_a_real_owner_approves_arrivals():
    require_owner(OWNER)
    for user in (PLANNER, STORE, ADMIN, {**OWNER, "roles": ["Store"]}):
        with pytest.raises(HTTPException) as refused:
            require_owner(user)
        assert refused.value.status_code == 403


def test_propose_approve_groups_one_draft_po_per_vendor_per_iso_week_and_is_idempotent():
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        paper, glue = _item(db, "RMCAL-KRAFT-230"), _item(db, "RMCAL-GLUE", "ADHESIVE", "KG", "BULK")
        tue, wed, thu, next_tue = _days()
        # The vendor's last PO rate is the default rate of a scheduled line.
        manual = _approved_po(db, VENDOR_A, "Shree Kraft Mills", paper, 100, 31.5, tue)
        # A rate typed on a later draft nobody approved is not the vendor's last rate (checker 2026-10-28).
        create_purchase_order(PurchaseOrderCreate(request_id=uuid.uuid4(), supplier_id=VENDOR_A, supplier_name="Shree Kraft Mills",
            expected_date=tue, lines=[{"item_id": paper.id, "qty_ordered": 10, "unit_cost": 44.5, "uom": "KG"}]), db, PLANT, STORE)
        manual_rows = db.query(PurchaseLineSchedule).filter(PurchaseLineSchedule.purchase_order_line_id == uuid.UUID(manual["lines"][0]["id"])).all()
        assert [(row.current_date, row.scheduled_qty, row.confirmation_status) for row in manual_rows] == [(tue, 100, "TENTATIVE")]

        proposed = _propose(db, [
            {"item_id": paper.id, "entry_date": tue, "qty": 1200, "supplier_id": VENDOR_A, "supplier_name": "Shree Kraft Mills", "note": "short on Thu"},
            {"item_id": glue.id, "entry_date": wed, "qty": 80, "supplier_id": VENDOR_A, "supplier_name": "Shree Kraft Mills"},
            {"item_id": paper.id, "entry_date": next_tue, "qty": 900, "supplier_id": VENDOR_A, "supplier_name": "Shree Kraft Mills"},
            {"item_id": paper.id, "entry_date": thu, "qty": 500, "supplier_id": VENDOR_B, "supplier_name": "RM Seed Supplier", "source": "SUGGESTED"},
            {"item_id": glue.id, "entry_date": thu, "qty": 10},  # no vendor yet
        ])
        assert {row["approval_status"] for row in proposed} == {"PROPOSED"}
        plan = db.query(ProcurementPlan).filter_by(plant_id=PLANT, month=tue.replace(day=1)).one()
        assert plan.status == "CALENDAR" and plan.name == "RM inward calendar"
        ids = [uuid.UUID(row["id"]) for row in proposed]
        supply = calendar_supply(tue, next_tue, db, PLANT, PLANNER)
        assert sum(row["counted_qty"] for row in supply["arrivals"] if row.get("entry_id")) == 0  # proposals are not cover

        request_id = uuid.uuid4()
        result = _approve(db, ids, request_id, details={str(VENDOR_A): {"supplier_gst_no": "27AAACS1234F1Z5", "supplier_address": "MIDC, Pune"}})
        assert len(result["approved"]) == 4 and [row["reason"] for row in result["skipped"]] == [f"RMCAL-GLUE material on {thu.day} {thu.strftime('%b %Y')} needs a vendor"]
        orders = db.query(PurchaseOrder).filter(PurchaseOrder.plant_id == PLANT, PurchaseOrder.source == "SCHEDULE").order_by(PurchaseOrder.po_no).all()
        assert len(orders) == 3 and {order.status for order in orders} == {"DRAFT"}
        week_one_a = next(order for order in orders if order.supplier_id == VENDOR_A and order.metadata_json["schedule_week"] == iso_week_start(tue).isoformat())
        assert sorted((line.item.item_code, line.qty_ordered) for line in week_one_a.lines) == [("RMCAL-GLUE", 80), ("RMCAL-KRAFT-230", 1200)]
        assert week_one_a.scheduled_by == OWNER["sub"] and week_one_a.approved_schedule_hash == schedule_hash(db, week_one_a)
        assert week_one_a.metadata_json["supplier_gst_no"] == "27AAACS1234F1Z5" and week_one_a.metadata_json["payment_terms"]
        rates = {line.item.item_code: (line.unit_cost, line.metadata_json["rate_source"]) for line in week_one_a.lines}
        assert rates == {"RMCAL-KRAFT-230": (31.5, "VENDOR_LAST_PO"), "RMCAL-GLUE": (0.0, "RATE_NEEDED")}
        rows = db.query(PurchaseLineSchedule).filter(PurchaseLineSchedule.source_plan_entry_id.in_(ids)).all()
        assert len(rows) == 4 and {row.confirmation_status for row in rows} == {"TENTATIVE"} and all(row.revision_line_id for row in rows)
        entries = {str(row.id): row for row in db.query(ProcurementPlanEntry).filter(ProcurementPlanEntry.id.in_(ids)).all()}
        assert sorted(row.approval_status for row in entries.values()) == ["ON_PO"] * 4 + ["PROPOSED"]
        assert all(row.approved_by == OWNER["sub"] for row in entries.values() if row.approval_status == "ON_PO")

        # Same request again: replay. Another request with the same arrivals: nothing new.
        replay = _approve(db, ids, request_id)
        assert replay["idempotent"] is True and {row["id"] for row in replay["purchase_orders"]} == {str(order.id) for order in orders}
        again = _approve(db, ids[:4])
        assert again["approved"] == [] and len(again["already"]) == 4 and again["purchase_orders"] == []
        assert db.query(PurchaseOrder).filter(PurchaseOrder.plant_id == PLANT, PurchaseOrder.source == "SCHEDULE").count() == 3
        assert db.query(PlanConversion).filter_by(plant_id=PLANT, request_id=request_id).count() == 1

        # A later approval for the same vendor and week extends that draft and re-hashes it.
        extra = _propose(db, [{"item_id": paper.id, "entry_date": wed, "qty": 300, "supplier_id": VENDOR_A, "supplier_name": "Shree Kraft Mills"}])
        extended = _approve(db, [uuid.UUID(extra[0]["id"])])
        assert [row["id"] for row in extended["purchase_orders"]] == [str(week_one_a.id)]
        db.refresh(week_one_a)
        assert next(line.qty_ordered for line in week_one_a.lines if line.item_id == paper.id) == 1500
        assert week_one_a.approved_schedule_hash == schedule_hash(db, week_one_a)

        # Draft PDF prints the dated rows (this was a 500 for scheduled POs).
        pdf = asyncio.run(_bytes(purchase_order_pdf(week_one_a.id, None, db, PLANT, STORE)))
        assert pdf.startswith(b"%PDF-")
        queue = list_purchase_orders(None, None, None, "scheduled", 100, 0, db, PLANT, STORE)
        assert queue["summary"]["queues"]["scheduled"] == 3 and {row["source"] for row in queue["items"]} == {"SCHEDULE"}
        detail = get_purchase_order(week_one_a.id, db, PLANT, STORE)
        assert detail["send_check"]["mode"] == "SUBMIT_FOR_APPROVAL" and detail["send_check"]["rate_needed"] == ["RMCAL-GLUE"]


def test_send_unchanged_is_approved_on_schedule_changed_needs_owner_then_confirm_grn_received():
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        paper = _item(db, "RMCAL-KRAFT-301")
        tue, wed, thu, next_tue = _days()
        vendor = uuid.uuid4()
        _approved_po(db, vendor, "Rate Mill", paper, 50, 40, tue)
        rows = _propose(db, [{"item_id": paper.id, "entry_date": tue, "qty": 600, "supplier_id": vendor, "supplier_name": "Rate Mill"},
                             {"item_id": paper.id, "entry_date": next_tue, "qty": 400, "supplier_id": vendor, "supplier_name": "Rate Mill"}], user=STORE)
        result = _approve(db, [uuid.UUID(row["id"]) for row in rows])
        first, second = sorted(result["purchase_orders"], key=lambda row: row["schedule_week"])
        order = db.get(PurchaseOrder, uuid.UUID(first["id"]))
        assert get_purchase_order(order.id, db, PLANT, STORE)["send_check"]["mode"] == "SEND_ON_SCHEDULE"

        # The Owner moves his own approved arrival on the draft: the row moves, the hash follows.
        moved = calendar_update(uuid.UUID(rows[0]["id"]), CalendarEntryUpdate(entry_date=wed), db, PLANT, OWNER)
        assert moved["entry_date"] == wed.isoformat()
        db.refresh(order)
        assert order.lines[0].schedules[0].current_date == wed and order.approved_schedule_hash == schedule_hash(db, order)
        with pytest.raises(HTTPException) as not_owner:
            calendar_update(uuid.UUID(rows[0]["id"]), CalendarEntryUpdate(entry_date=thu), db, PLANT, PLANNER)
        assert not_owner.value.status_code == 403

        # Unchanged → approved by the Owner's schedule approval, then sent.
        sent = send_purchase_order(order.id, SendToVendorPayload(expected_version=order.version, channel="WHATSAPP"), db, PLANT, STORE)
        assert sent["status"] == "APPROVED" and sent["approval_source"] == "SCHEDULE" and sent["approved_by"] == OWNER["sub"]
        assert sent["sent_channel"] == "WHATSAPP" and sent["sent_by"] == STORE["sub"]
        revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=order.id, revision_no=1).one()
        decision = db.query(PurchaseApprovalDecision).filter_by(revision_id=revision.id, decision="APPROVED").one()
        assert revision.approval_state == "APPROVED" and decision.actor == OWNER["sub"] and "sent unchanged by" in decision.reason

        # Changed after approval (desk edits qty) → refused, then the normal Submit → Owner approval → Send.
        other = db.get(PurchaseOrder, uuid.UUID(second["id"]))
        line = other.lines[0]
        revised = create_purchase_order_revision(other.id, PurchaseRevisionCreate(request_id=uuid.uuid4(), supplier_id=other.supplier_id,
            supplier_name=other.supplier_name_snapshot, expected_date=other.expected_date, change_reason="Vendor asked for a full truck",
            expected_version=other.version, lines=[{"item_id": line.item_id, "logical_line_id": line.logical_line_id, "qty_ordered": 450,
                                                    "unit_cost": line.unit_cost, "uom": "KG"}]), db, PLANT, STORE)
        assert revised["send_check"]["mode"] == "SUBMIT_FOR_APPROVAL"
        with pytest.raises(HTTPException) as changed:
            send_purchase_order(other.id, SendToVendorPayload(expected_version=revised["version"], channel="EMAIL"), db, PLANT, STORE)
        assert changed.value.status_code == 409 and changed.value.detail["code"] == "NEEDS_APPROVAL"
        submitted = submit_purchase_order(other.id, RevisionActionPayload(expected_version=revised["version"]), db, PLANT, STORE)
        approved = approve_purchase_order(other.id, RevisionActionPayload(expected_version=submitted["version"]), db, PLANT, OWNER2)
        assert approved["approval_source"] == "OWNER"
        resent = send_purchase_order(other.id, SendToVendorPayload(expected_version=approved["version"], channel="EMAIL"), db, PLANT, STORE)
        assert resent["sent_channel"] == "EMAIL" and resent["status"] == "APPROVED"

        # Moving a sent arrival asks first, then makes a dates-only revision that goes to the vendor again.
        with pytest.raises(HTTPException) as ask:
            calendar_update(uuid.UUID(rows[0]["id"]), CalendarEntryUpdate(entry_date=thu), db, PLANT, OWNER)
        assert ask.value.status_code == 409 and "PO already sent" in ask.value.detail
        calendar_update(uuid.UUID(rows[0]["id"]), CalendarEntryUpdate(entry_date=thu, confirm_po_change=True), db, PLANT, OWNER)
        db.refresh(order)
        assert order.current_revision_no == 2 and order.sent_at is None and order.status == "APPROVED"
        assert db.query(PurchaseOrderRevision).filter_by(purchase_order_id=order.id, revision_no=2).one().approval_state == "APPROVED"
        order = db.get(PurchaseOrder, order.id)
        sent = send_purchase_order(order.id, SendToVendorPayload(expected_version=order.version, channel="PDF"), db, PLANT, STORE)

        # Vendor confirms the date → CONFIRMED.
        row = db.query(PurchaseLineSchedule).filter_by(source_plan_entry_id=uuid.UUID(rows[0]["id"])).one()
        confirmed = vendor_confirm_purchase_order(order.id, VendorConfirmPayload(expected_version=sent["version"],
            rows=[{"schedule_id": row.id, "confirmed_date": thu}]), db, PLANT, STORE)
        assert confirmed["vendor_confirmed_by"] == STORE["sub"]
        db.refresh(row)
        assert row.confirmation_status == "CONFIRMED" and row.current_date == thu

        arrivals = calendar_expected_arrivals(db, PLANT, STORE)["items"]
        mine = next(item for item in arrivals if item.get("schedule_id") == str(row.id))
        assert mine["state"] == "CONFIRMED" and mine["open_qty"] == 600 and mine["bucket"] in {"THIS_WEEK", "LATER"}

        # GRN fills the row (oldest first) → the calendar shows it received and counts nothing more.
        receipt = post_governed_receipt(GovernedReceiptCreate(request_id=uuid.uuid4(), purchase_order_id=order.id, received_date=ist_today(),
            supplier_challan_no=f"CH-{uuid.uuid4().hex[:6]}", invoice_pending=True,
            lines=[{"po_line_id": order.lines[0].id, "lots": [{"source_reel_no": "RM-1", "net_weight_kg": 600, "width_mm": 120}]}]), db, PLANT, STORE)
        assert receipt["received_kg"] == 600
        supply = calendar_supply(ist_today(), next_tue, db, PLANT, STORE)
        shown = next(item for item in supply["arrivals"] if item.get("entry_id") == rows[0]["id"])
        assert shown["state"] == "RECEIVED" and shown["counted_qty"] == 0 and shown["received_qty"] == 600
        # Received early: the chip sits on the GRN day, and still says which day it was planned for.
        assert shown["date"] == ist_today().isoformat() and shown["received_on"] == ist_today().isoformat() and shown["planned_date"] == thu.isoformat()


def test_cancel_drops_the_line_from_a_draft_and_proposals_need_no_owner():
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        paper = _item(db, "RMCAL-KRAFT-401")
        tue, wed, _thu, _next = _days()
        vendor = uuid.uuid4()
        rows = _propose(db, [{"item_id": paper.id, "entry_date": tue, "qty": 200, "supplier_id": vendor, "supplier_name": "Cancel Mill"},
                             {"item_id": paper.id, "entry_date": wed, "qty": 100, "supplier_id": vendor, "supplier_name": "Cancel Mill"}])
        proposal = _propose(db, [{"item_id": paper.id, "entry_date": wed, "qty": 5, "supplier_id": vendor, "supplier_name": "Cancel Mill"}])[0]
        moved = calendar_update(uuid.UUID(proposal["id"]), CalendarEntryUpdate(qty=7), db, PLANT, STORE)
        assert moved["qty"] == 7
        assert calendar_cancel(uuid.UUID(proposal["id"]), CalendarEntryCancel(reason="Not needed"), db, PLANT, STORE)["approval_status"] == "CANCELLED"
        result = _approve(db, [uuid.UUID(row["id"]) for row in rows])
        order = db.get(PurchaseOrder, uuid.UUID(result["purchase_orders"][0]["id"]))
        with pytest.raises(HTTPException) as refused:
            calendar_cancel(uuid.UUID(rows[1]["id"]), CalendarEntryCancel(), db, PLANT, PLANNER)
        assert refused.value.status_code == 403
        calendar_cancel(uuid.UUID(rows[1]["id"]), CalendarEntryCancel(reason="Mill short"), db, PLANT, OWNER)
        db.refresh(order)
        assert order.lines[0].qty_ordered == 200 and order.approved_schedule_hash == schedule_hash(db, order)
        calendar_cancel(uuid.UUID(rows[0]["id"]), CalendarEntryCancel(), db, PLANT, OWNER)
        db.refresh(order)
        assert order.status == "CANCELLED"
        with pytest.raises(HTTPException) as past:
            _propose(db, [{"item_id": paper.id, "entry_date": ist_today() - timedelta(days=1), "qty": 5}])
        assert past.value.status_code == 422


def test_desk_revision_moves_delivery_rows_and_keeps_the_po_facts():
    """A desk quantity change reaches the dated rows (cover, Expected arrivals, PDF) and the arrival;
    the vendor-week tag, vendor facts and line source survive; a sent PO must go again."""
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        box = _item(db, "RMCAL-BOX-R150", "PACKAGING", "PCS", "BULK")
        tue, _wed, _thu, _next = _days()
        vendor = uuid.uuid4()
        _approved_po(db, vendor, "Box Mill", box, 10, 12, tue)
        rows = _propose(db, [{"item_id": box.id, "entry_date": tue, "qty": 100, "supplier_id": vendor, "supplier_name": "Box Mill"}])
        result = _approve(db, [uuid.UUID(rows[0]["id"])], details={str(vendor): {"supplier_phone": "98200 00000", "supplier_gst_no": "27BOXMILL1234Z5"}})
        order = db.get(PurchaseOrder, uuid.UUID(result["purchase_orders"][0]["id"]))
        assert order.lines[0].unit_cost == 12 and order.lines[0].metadata_json["rate_source"] == "VENDOR_LAST_PO"
        sent = send_purchase_order(order.id, SendToVendorPayload(expected_version=order.version, channel="EMAIL"), db, PLANT, STORE)
        line = order.lines[0]
        revised = create_purchase_order_revision(order.id, PurchaseRevisionCreate(request_id=uuid.uuid4(), supplier_id=vendor,
            supplier_name="Box Mill", expected_date=order.expected_date, change_reason="Vendor has 80 boxes", expected_version=sent["version"],
            lines=[{"item_id": box.id, "logical_line_id": line.logical_line_id, "qty_ordered": 80, "unit_cost": 12, "uom": "PCS"}]), db, PLANT, STORE)
        schedule = revised["lines"][0]["schedules"]
        assert [(row["scheduled_qty"], row["open_qty"]) for row in schedule] == [(80, 80)]
        assert revised["schedule_week"] == iso_week_start(tue).isoformat()
        assert revised["metadata_json"]["supplier_phone"] == "98200 00000" and revised["supplier_gst_no"] == "27BOXMILL1234Z5"
        assert revised["lines"][0]["metadata_json"]["source"] == "SCHEDULE" and revised["lines"][0]["rate_source"] == "VENDOR_LAST_PO"
        assert revised["sent_at"] is None and "Revision 2" in revised["metadata_json"]["resend_reason"]
        entry = db.get(ProcurementPlanEntry, uuid.UUID(rows[0]["id"]))
        assert float(entry.qty_kg) == 80
        supply = calendar_supply(ist_today(), tue + timedelta(days=7), db, PLANT, STORE)
        shown = next(item for item in supply["arrivals"] if item.get("entry_id") == rows[0]["id"])
        assert shown["qty"] == 80 and shown["open_qty"] == 80

        # More than before: the open row grows; the PDF prints the new quantity (no 500).
        db.expire_all()
        order = db.get(PurchaseOrder, order.id)
        grown = create_purchase_order_revision(order.id, PurchaseRevisionCreate(request_id=uuid.uuid4(), supplier_id=vendor,
            supplier_name="Box Mill", expected_date=order.expected_date, change_reason="Full truck", expected_version=order.version,
            lines=[{"item_id": box.id, "logical_line_id": line.logical_line_id, "qty_ordered": 120, "unit_cost": 12.5, "uom": "PCS"}]), db, PLANT, STORE)
        assert [row["scheduled_qty"] for row in grown["lines"][0]["schedules"]] == [120]
        assert grown["lines"][0]["rate_source"] == "DESK" and grown["send_check"]["mode"] == "SUBMIT_FOR_APPROVAL"
        pdf = asyncio.run(_bytes(purchase_order_pdf(order.id, None, db, PLANT, STORE)))
        assert pdf.startswith(b"%PDF-")


def test_calendar_roles_qc_pending_and_late_proposals():
    from src.models import StockBatch, StockTransaction
    from src.services import rm_calendar

    # Spec 2.8: Admin alone neither proposes nor sends; a real Owner and the desk roles do.
    proposer = rm_calendar.desk_role(rm_calendar.CALENDAR_PROPOSERS, "no")
    for user in (PLANNER, STORE, OWNER, {**ADMIN, "roles": ["Admin", "Owner"], "actual_roles": ["Admin", "Owner"]}):
        assert proposer(user) is user
    for user in (ADMIN, {"sub": "grn@example.com", "roles": ["GRN"], "actual_roles": ["GRN"], "role": "GRN"}):
        with pytest.raises(HTTPException) as refused:
            proposer(user)
        assert refused.value.status_code == 403
    from src.routers.procurement import calendar_viewer
    assert calendar_viewer({"sub": "grn@example.com", "roles": ["GRN"]})
    with pytest.raises(HTTPException):
        calendar_viewer({"sub": "op@example.com", "roles": ["Operator"]})

    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        glue = _item(db, "RMCAL-GLUE-QC", "ADHESIVE", "KG", "BULK")
        tue, _wed, _thu, _next = _days()
        vendor = uuid.uuid4()
        _approved_po(db, vendor, "Glue Co", glue, 50, 90, tue)
        order = db.query(PurchaseOrder).filter(PurchaseOrder.plant_id == PLANT, PurchaseOrder.supplier_id == vendor).one()
        post_governed_receipt(GovernedReceiptCreate(request_id=uuid.uuid4(), purchase_order_id=order.id, received_date=ist_today(),
            supplier_challan_no=f"CH-{uuid.uuid4().hex[:6]}", invoice_pending=True,
            lines=[{"po_line_id": order.lines[0].id, "quantity": 40}]), db, PLANT, STORE)
        # A count gain put on QC hold (no GRN) is held stock, not stock waiting for incoming QC.
        gain = StockBatch(item_id=glue.id, batch_no=f"ADJ-{uuid.uuid4().hex[:6]}", received_qty=7, stock_status="QC_HOLD", plant_id=PLANT)
        db.add(gain)
        db.flush()
        db.add(StockTransaction(item_id=glue.id, batch_id=gain.id, transaction_type="ADJUSTMENT", qty_change=7, reference_type="ADJUSTMENT",
            reference_id=uuid.uuid4(), stock_status="QC_HOLD", plant_id=PLANT))
        db.commit()
        supply = calendar_supply(ist_today(), tue, db, PLANT, STORE)
        item = next(row for row in supply["items"] if row["item_code"] == "RMCAL-GLUE-QC")
        assert item["qc_pending_qty"] == 40 and item["other_held_qty"] == 7

        # A proposal nobody approved by its date stays visible as late; approving puts it on today.
        late = ProcurementPlanEntry(plan_id=rm_calendar.calendar_plan(db, PLANT, ist_today() - timedelta(days=2), PLANNER["sub"]).id,
            entry_date=ist_today() - timedelta(days=2), item_id=glue.id, supplier_id=vendor, supplier_name_snapshot="Glue Co",
            material_form="BULK", qty_kg=25, status="PLANNED", approval_status="PROPOSED", source="MANUAL", proposed_by=PLANNER["sub"])
        db.add(late)
        db.commit()
        supply = calendar_supply(ist_today(), tue, db, PLANT, STORE)
        shown = next(row for row in supply["arrivals"] if row.get("entry_id") == str(late.id))
        assert shown["state"] == "PROPOSED" and shown["late_proposal"] is True and shown["rate"] == 90 and shown["rate_source"] == "VENDOR_LAST_PO"
        _approve(db, [late.id])
        db.refresh(late)
        assert late.entry_date == ist_today() and late.approval_status == "ON_PO" and "approved late" in late.notes
        row = db.get(PurchaseLineSchedule, late.schedule_row_id)
        assert row.current_date == ist_today()


def _revise(db, order, user, *, rate=None, qty=None, reason="Desk change"):
    order = db.get(PurchaseOrder, order.id)
    return create_purchase_order_revision(order.id, PurchaseRevisionCreate(request_id=uuid.uuid4(), supplier_id=order.supplier_id,
        supplier_name=order.supplier_name_snapshot, expected_date=order.expected_date, notes=order.notes, change_reason=reason, expected_version=order.version,
        lines=[{"item_id": line.item_id, "logical_line_id": line.logical_line_id, "qty_ordered": qty if qty is not None else line.qty_ordered,
                "unit_cost": rate if rate is not None else line.unit_cost, "uom": line.uom} for line in order.lines]), db, PLANT, user)


def test_owner_fills_a_missing_rate_himself_and_decides_scheduled_pos_without_a_second_owner():
    """Checker 2026-10-28: with one Owner, a scheduled draft whose rate he filled could never be approved."""
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        paper = _item(db, "RMCAL-KRAFT-501")
        tue, wed, _thu, next_tue = _days()
        vendor = uuid.uuid4()
        rows = _propose(db, [{"item_id": paper.id, "entry_date": tue, "qty": 300, "supplier_id": vendor, "supplier_name": "New Mill"},
                             {"item_id": paper.id, "entry_date": next_tue, "qty": 200, "supplier_id": vendor, "supplier_name": "New Mill"}])
        result = _approve(db, [uuid.UUID(row["id"]) for row in rows])
        first, second = (db.get(PurchaseOrder, uuid.UUID(row["id"])) for row in sorted(result["purchase_orders"], key=lambda row: row["schedule_week"]))
        detail = get_purchase_order(first.id, db, PLANT, STORE)
        assert detail["send_check"]["mode"] == "SUBMIT_FOR_APPROVAL" and detail["send_check"]["rate_needed_names"] == ["RMCAL-KRAFT-501 material"]
        # The Owner may not approve a PO that still has no rate.
        with pytest.raises(HTTPException) as no_rate:
            approve_purchase_order(first.id, RevisionActionPayload(expected_version=detail["version"]), db, PLANT, OWNER)
        assert no_rate.value.status_code == 422 and "Fill the rate" in no_rate.value.detail
        db.rollback()

        # He fills the rate himself: that is his approval, so the desk sends it with no second Owner.
        filled = _revise(db, first, OWNER, rate=40, reason="Owner filled the rate")
        assert filled["send_check"]["mode"] == "SEND_ON_SCHEDULE" and filled["scheduled_by"] == OWNER["sub"]
        sent = send_purchase_order(first.id, SendToVendorPayload(expected_version=filled["version"], channel="WHATSAPP"), db, PLANT, STORE)
        assert sent["status"] == "APPROVED" and sent["approval_source"] == "SCHEDULE" and sent["approved_by"] == OWNER["sub"]

        # The desk fills the other draft's rate: the PO says exactly what changed, and the Owner
        # approves it straight from the PO page (no Submit step), although he made revision 1.
        changed = _revise(db, second, PLANNER, rate=41.5)
        assert changed["send_check"]["mode"] == "SUBMIT_FOR_APPROVAL"
        assert changed["send_check"]["changes"] == ["Rate for RMCAL-KRAFT-501 material filled in: ₹41.50 / kg."]
        approved = approve_purchase_order(second.id, RevisionActionPayload(expected_version=changed["version"]), db, PLANT, OWNER)
        assert approved["status"] == "APPROVED" and approved["approval_source"] == "OWNER"

        # A submitted scheduled revision the Owner made and submitted himself: he decides it (approve or reject).
        rows = _propose(db, [{"item_id": paper.id, "entry_date": wed, "qty": 120, "supplier_id": vendor, "supplier_name": "New Mill"}])
        third = db.get(PurchaseOrder, uuid.UUID(_approve(db, [uuid.UUID(rows[0]["id"])])["purchase_orders"][0]["id"]))
        assert third.id not in {first.id, second.id}
        revised = _revise(db, third, PLANNER, qty=150)
        submitted = submit_purchase_order(third.id, RevisionActionPayload(expected_version=revised["version"]), db, PLANT, OWNER)
        assert submitted["revision_makers"] == [PLANNER["sub"], OWNER["sub"]] and submitted["owner_may_decide_own"] is True
        rejected = reject_purchase_order(third.id, RevisionActionPayload(expected_version=submitted["version"], reason="Too much"), db, PLANT, OWNER)
        assert rejected["status"] == "REJECTED"

        # A rejected PO is no cover: its arrival shows as "PO rejected" and counts nothing; the desk sees it under "returned".
        supply = calendar_supply(ist_today(), next_tue, db, PLANT, STORE)
        shown = next(row for row in supply["arrivals"] if row.get("entry_id") == rows[0]["id"])
        assert shown["state"] == "REJECTED" and shown["counted_qty"] == 0 and shown["overdue"] is False
        returned = list_purchase_orders(None, None, None, "returned", 100, 0, db, PLANT, STORE)
        assert str(third.id) in {str(row["id"]) for row in returned["items"]} and returned["summary"]["queues"]["returned"] >= 1

        # A hand-made PO the Owner made himself: the Owner (or an Admin) may approve their own PO
        # (user decision 2026-10-30); the history says it was approved by the same person.
        made = create_purchase_order(PurchaseOrderCreate(request_id=uuid.uuid4(), supplier_id=vendor, supplier_name="New Mill",
            expected_date=tue, lines=[{"item_id": paper.id, "qty_ordered": 10, "unit_cost": 40, "uom": "KG"}]), db, PLANT, OWNER)
        waiting = submit_purchase_order(made["id"], RevisionActionPayload(expected_version=made["version"]), db, PLANT, STORE)
        assert waiting["owner_may_decide_own"] is False and OWNER["sub"] in waiting["revision_makers"]
        own = approve_purchase_order(made["id"], RevisionActionPayload(expected_version=waiting["version"]), db, PLANT, OWNER)
        assert own["status"] == "APPROVED" and own["approved_by"] == OWNER["sub"]


def test_moving_an_arrival_into_another_week_regroups_it_and_vendor_dates_are_never_past():
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        paper = _item(db, "RMCAL-KRAFT-601")
        tue, wed, _thu, next_tue = _days()
        vendor = uuid.uuid4()
        _approved_po(db, vendor, "Week Mill", paper, 10, 38, tue)
        rows = _propose(db, [{"item_id": paper.id, "entry_date": tue, "qty": 100, "supplier_id": vendor, "supplier_name": "Week Mill"},
                             {"item_id": paper.id, "entry_date": wed, "qty": 50, "supplier_id": vendor, "supplier_name": "Week Mill"},
                             {"item_id": paper.id, "entry_date": next_tue, "qty": 70, "supplier_id": vendor, "supplier_name": "Week Mill"}])
        result = _approve(db, [uuid.UUID(row["id"]) for row in rows], details={str(vendor): {"supplier_gst_no": "27WEEKMILL12Z5"}})
        week_one, week_two = (db.get(PurchaseOrder, uuid.UUID(row["id"])) for row in sorted(result["purchase_orders"], key=lambda row: row["schedule_week"]))

        # Wed's 50 moves into next week: it leaves week one's draft and joins week two's (one PO per vendor-week).
        calendar_update(uuid.UUID(rows[1]["id"]), CalendarEntryUpdate(entry_date=next_tue + timedelta(days=1)), db, PLANT, OWNER)
        db.expire_all()
        week_one, week_two = db.get(PurchaseOrder, week_one.id), db.get(PurchaseOrder, week_two.id)
        assert [line.qty_ordered for line in week_one.lines] == [100] and [line.qty_ordered for line in week_two.lines] == [120]
        assert week_one.approved_schedule_hash == schedule_hash(db, week_one) and week_two.approved_schedule_hash == schedule_hash(db, week_two)
        moved = db.get(ProcurementPlanEntry, uuid.UUID(rows[1]["id"]))
        assert moved.po_id == week_two.id and moved.approval_status == "ON_PO"
        assert sorted(row.current_date for row in week_two.lines[0].schedules) == [next_tue, next_tue + timedelta(days=1)]

        # Moving week one's only arrival to a week with no draft makes a new draft and cancels the empty one.
        far = next_tue + timedelta(days=7)
        calendar_update(uuid.UUID(rows[0]["id"]), CalendarEntryUpdate(entry_date=far), db, PLANT, OWNER)
        db.expire_all()
        assert db.get(PurchaseOrder, week_one.id).status == "CANCELLED"
        entry = db.get(ProcurementPlanEntry, uuid.UUID(rows[0]["id"]))
        new_po = db.get(PurchaseOrder, entry.po_id)
        assert new_po.metadata_json["schedule_week"] == iso_week_start(far).isoformat() and new_po.metadata_json["supplier_gst_no"] == "27WEEKMILL12Z5"
        assert get_purchase_order(new_po.id, db, PLANT, STORE)["send_check"]["mode"] == "SEND_ON_SCHEDULE"

        # Vendor confirmation never takes a day that has passed.
        sent = send_purchase_order(new_po.id, SendToVendorPayload(expected_version=new_po.version, channel="PDF"), db, PLANT, STORE)
        row = db.get(PurchaseLineSchedule, entry.schedule_row_id)
        with pytest.raises(HTTPException) as past:
            vendor_confirm_purchase_order(new_po.id, VendorConfirmPayload(expected_version=sent["version"],
                rows=[{"schedule_id": row.id, "confirmed_date": ist_today() - timedelta(days=27)}]), db, PLANT, STORE)
        assert past.value.status_code == 422 and "has passed" in past.value.detail
        db.rollback()

        # Every waiting proposal comes back whatever the window (the Owner bar counts them all).
        later = _propose(db, [{"item_id": paper.id, "entry_date": far + timedelta(days=30), "qty": 9, "supplier_id": vendor, "supplier_name": "Week Mill"}])
        supply = calendar_supply(ist_today(), ist_today() + timedelta(days=27), db, PLANT, STORE)
        assert any(row.get("entry_id") == later[0]["id"] and row["state"] == "PROPOSED" for row in supply["arrivals"])


def test_unsent_tab_leaves_out_old_pos_whose_goods_came_but_keeps_resends():
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        glue = _item(db, "RMCAL-GLUE-701", "ADHESIVE", "KG", "BULK")
        tue, _wed, _thu, _next = _days()
        old = _approved_po(db, uuid.uuid4(), "Old Glue Co", glue, 100, 50, tue)
        fresh = _approved_po(db, uuid.uuid4(), "Fresh Glue Co", glue, 100, 50, tue)
        order = db.get(PurchaseOrder, uuid.UUID(str(old["id"])))
        post_governed_receipt(GovernedReceiptCreate(request_id=uuid.uuid4(), purchase_order_id=order.id, received_date=ist_today(),
            supplier_challan_no=f"CH-{uuid.uuid4().hex[:6]}", invoice_pending=True,
            lines=[{"po_line_id": order.lines[0].id, "quantity": 40}]), db, PLANT, STORE)
        unsent = {str(row["id"]) for row in list_purchase_orders(None, None, None, "unsent", 500, 0, db, PLANT, STORE)["items"]}
        sent = {str(row["id"]) for row in list_purchase_orders(None, None, None, "sent", 500, 0, db, PLANT, STORE)["items"]}
        assert str(fresh["id"]) in unsent and str(old["id"]) not in unsent and str(old["id"]) in sent


async def _bytes(response):
    return b"".join([chunk async for chunk in response.body_iterator])


def _revise_terms(db, order, user, *, payment_terms=None, gsm=None, qc=True, reason="Desk change"):
    order = db.get(PurchaseOrder, order.id)
    return create_purchase_order_revision(order.id, PurchaseRevisionCreate(request_id=uuid.uuid4(), supplier_id=order.supplier_id,
        supplier_name=order.supplier_name_snapshot, expected_date=order.expected_date, notes=order.notes, change_reason=reason, expected_version=order.version,
        payment_terms=payment_terms, lines=[{"item_id": line.item_id, "logical_line_id": line.logical_line_id, "qty_ordered": line.qty_ordered,
            "unit_cost": line.unit_cost, "uom": line.uom, "gsm": gsm, "incoming_qc_required": qc} for line in order.lines]), db, PLANT, user)


def test_desk_changes_to_terms_specs_or_qc_need_the_owner_but_a_no_op_edit_does_not():
    """Checker 2026-10-29: payment terms, specs and the QC tick could change on a scheduled draft and the
    desk could still send it as approved by the Owner."""
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        paper = _item(db, "RMCAL-KRAFT-801")
        tue, wed, thu, _next = _days()
        vendor = uuid.uuid4()
        _approved_po(db, vendor, "Terms Mill", paper, 10, 44, tue)
        orders = []
        for day in (tue, wed, thu):
            vendor_week = _propose(db, [{"item_id": paper.id, "entry_date": day, "qty": 100, "supplier_id": vendor, "supplier_name": "Terms Mill"}])
            orders.append(db.get(PurchaseOrder, uuid.UUID(_approve(db, [uuid.UUID(vendor_week[0]["id"])])["purchase_orders"][0]["id"])))
        order = orders[0]
        assert len({row.id for row in orders}) == 1, "same vendor, same ISO week: one draft"

        # A desk save that changes nothing the vendor reads (the PO date moves to today) keeps the Owner's approval.
        same = _revise_terms(db, order, STORE)
        assert same["send_check"]["mode"] == "SEND_ON_SCHEDULE", same["send_check"]

        changed = _revise_terms(db, order, STORE, payment_terms="Advance payment.")
        assert changed["send_check"]["mode"] == "SUBMIT_FOR_APPROVAL" and "Payment terms changed." in changed["send_check"]["changes"]
        with pytest.raises(HTTPException) as refused:
            send_purchase_order(order.id, SendToVendorPayload(expected_version=changed["version"], channel="PDF"), db, PLANT, STORE)
        assert refused.value.status_code == 409 and refused.value.detail["code"] == "NEEDS_APPROVAL"

        # A specification is on the hash too, with its own plain reason. There is no QC tick any more
        # (C2, 30 Oct): a caller sending false changes nothing, the line stays on incoming QC.
        changed = _revise_terms(db, order, STORE, payment_terms="Advance payment.", gsm=230, qc=False)
        reasons = changed["send_check"]["changes"]
        assert "Specification of RMCAL-KRAFT-801 material changed." in reasons
        assert not any("Incoming QC" in reason for reason in reasons)
        assert all(line["incoming_qc_required"] is True for line in changed["lines"])

        # A new approval of more arrivals never extends a draft the desk changed: it makes a fresh one.
        extra = _propose(db, [{"item_id": paper.id, "entry_date": tue, "qty": 5, "supplier_id": vendor, "supplier_name": "Terms Mill"}])
        fresh = _approve(db, [uuid.UUID(extra[0]["id"])])["purchase_orders"][0]
        assert fresh["id"] != str(order.id)


def test_approval_takes_the_vendor_from_the_master_and_skips_unknown_vendors():
    """Checker 2026-10-29: any supplier id and name became a draft PO (unknown, other plant, mismatched name)."""
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        paper = _item(db, "RMCAL-KRAFT-802")
        tue, _wed, _thu, _next = _days()
        known, ghost = uuid.uuid4(), uuid.uuid4()
        rows = _propose(db, [{"item_id": paper.id, "entry_date": tue, "qty": 70, "supplier_id": known, "supplier_name": "Totally Different Name"},
                             {"item_id": paper.id, "entry_date": tue, "qty": 30, "supplier_id": ghost, "supplier_name": "Ghost Vendor"}])
        master = {str(known): {"supplier_name": "Umiya Paper Mills", "supplier_gst_no": "24ABCDE1234F1Z5"}}
        result = calendar_approve(CalendarApprove(request_id=uuid.uuid4(), entry_ids=[uuid.UUID(row["id"]) for row in rows],
                                                  vendor_details=master, vendor_master_checked=True), db, PLANT, OWNER)
        assert result["approved"] == [rows[0]["id"]]
        assert result["skipped"][0]["id"] == rows[1]["id"] and "not an active vendor of this plant" in result["skipped"][0]["reason"]
        order = db.get(PurchaseOrder, uuid.UUID(result["purchase_orders"][0]["id"]))
        assert order.supplier_name_snapshot == "Umiya Paper Mills" and order.metadata_json["supplier_gst_no"] == "24ABCDE1234F1Z5"
        assert db.get(ProcurementPlanEntry, uuid.UUID(rows[0]["id"])).supplier_name_snapshot == "Umiya Paper Mills"
        assert db.get(ProcurementPlanEntry, uuid.UUID(rows[1]["id"])).approval_status == "PROPOSED"


def test_calendar_rates_read_in_one_batch_match_the_single_item_rule():
    """Checker 2026-10-29: supply looked the rate up two or three queries per material."""
    from src.services.rm_calendar import RateBook, default_rate
    with SessionLocal() as db, patch("src.routers.purchase.emit_audit_event"):
        paper, glue = _item(db, "RMCAL-KRAFT-803"), _item(db, "RMCAL-GLUE-803", "ADHESIVE", "KG", "BULK")
        tue, _wed, _thu, _next = _days()
        vendor = uuid.uuid4()
        _approved_po(db, vendor, "Book Mill", paper, 10, 47.25, tue)
        book = RateBook(db, PLANT, [paper.id, glue.id])
        for supplier in (vendor, None, uuid.uuid4()):
            for item in (paper, glue):
                assert book.rate(supplier, item.id) == default_rate(db, PLANT, supplier, item.id)
        assert book.rate(vendor, paper.id) == (47.25, "VENDOR_LAST_PO") and book.last_vendor[str(paper.id)]["supplier_name"] == "Book Mill"
