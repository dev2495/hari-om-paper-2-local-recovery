"""End-to-end procurement controls against a migrated isolated PostgreSQL DB."""
import asyncio
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL database", allow_module_level=True)

from src.database import SessionLocal
from src.models import (
    ItemMaster,
    LabelPrintJob,
    LotLabelRecord,
    PaperReel,
    PurchaseDebitNote,
    PurchaseDiscrepancy,
    PurchaseDeliverySchedule,
    PurchaseOrder,
    PurchaseOrderRevision,
    PurchaseReceipt,
    ReceiptStockAllocation,
    RmCostSheet,
    RmCostVersion,
    StockAlertPolicy,
    StockTransaction,
    SupplierInvoice,
)
from src.routers.procurement import (
    CostDraftCreate,
    DebitNoteAction,
    DebitNoteCreate,
    DiscrepancyAction,
    GovernedReceiptCreate,
    LabelJobCreate,
    MrpRunInput,
    PlanConversionInput,
    PlanCreate,
    PlanStatusAction,
    SettlementCreate,
    StockPolicyCreate,
    VersionAction,
    act_on_debit_note,
    act_on_discrepancy,
    create_debit_note,
    create_cost_draft,
    create_label_job,
    create_plan,
    create_stock_policy,
    activate_cost_version,
    activate_stock_policy,
    act_on_plan,
    convert_plan_to_purchase_orders,
    post_governed_receipt,
    run_mrp,
    settle_debit_note,
    debit_note_pdf,
)
from src.routers.purchase import (
    PurchaseOrderCreate,
    RevisionActionPayload,
    ShortClosePayload,
    approve_purchase_order,
    create_purchase_order,
    get_purchase_order,
    purchase_order_pdf,
    short_close_purchase_order,
    submit_purchase_order,
)


PLANT = "00000000-0000-0000-0000-0000000000a1"
MAKER = {"sub": "store.maker@example.com", "roles": ["Store"], "token": ""}
CHECKER = {"sub": "plant.checker@example.com", "roles": ["PlantManager"], "token": ""}
ACCOUNTS = {"sub": "accounts.maker@example.com", "roles": ["Accounts"], "token": ""}


def _paper(db):
    return db.query(ItemMaster).filter(ItemMaster.item_code == "PAPER-SEED-A-STEP5").one()


def test_duplicate_month_plan_returns_conflict_and_exact_retry_returns_saved_plan():
    with SessionLocal() as db:
        payload = PlanCreate(request_id=uuid.uuid4(), month=date(2026, 12, 1),
                             name=f"Concurrent month {uuid.uuid4()}", entries=[])
        saved = create_plan(payload, db, PLANT, MAKER)
        assert create_plan(payload, db, PLANT, MAKER)["id"] == saved["id"]
        different_request = payload.model_copy(update={"request_id": uuid.uuid4()})
        with pytest.raises(HTTPException) as error:
            create_plan(different_request, db, PLANT, MAKER)
        assert error.value.status_code == 409
        # Failed insert rolls back cleanly; the original remains readable.
        assert create_plan(payload, db, PLANT, MAKER)["id"] == saved["id"]


async def _response_bytes(response):
    return b"".join([chunk async for chunk in response.body_iterator])


def _create_approved_po(db, *, supplier_id, category="RM_PM", quantity=10000, rate=30):
    payload = PurchaseOrderCreate(
        request_id=uuid.uuid4(), category=category, supplier_id=supplier_id,
        supplier_name="UPPM Paper Mill", expected_date=date(2026, 9, 20),
        payment_terms="60 days", freight_terms="Included", tax_terms="GST extra",
        lines=[{
            "item_id": _paper(db).id, "qty_ordered": quantity, "unit_cost": rate,
            "uom": "KG", "expected_unit_count": 8, "count_basis": "ESTIMATED",
            "incoming_qc_required": False, "width_mm": 120, "width_tolerance_mm": 2, "gsm": 230,
        }],
    )
    created = create_purchase_order(payload, db, PLANT, MAKER)
    revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=created["id"]).one()
    submitted = submit_purchase_order(
        created["id"], RevisionActionPayload(expected_version=created["version"], content_hash=revision.content_hash, reason="Ready"),
        db, PLANT, MAKER,
    )
    approved = approve_purchase_order(
        created["id"], RevisionActionPayload(expected_version=submitted["version"], content_hash=revision.content_hash, reason="Approved"),
        db, PLANT, CHECKER,
    )
    return approved


def test_po_to_nine_physical_lots_invoice_variance_claim_and_retry():
    db = SessionLocal()
    supplier_id = uuid.uuid4()
    try:
        with patch("src.routers.purchase.emit_audit_event"):
            po = _create_approved_po(db, supplier_id=supplier_id)
        assert po["po_no"] == "RP-PM/01"
        assert get_purchase_order(po["id"], db, PLANT, MAKER)["po_no"] == "RP-PM/01"
        assert asyncio.run(_response_bytes(purchase_order_pdf(po["id"], 1, db, PLANT, MAKER))).startswith(b"%PDF-")
        line_id = uuid.UUID(po["lines"][0]["id"])
        first_request = GovernedReceiptCreate(
            request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=date(2026, 9, 19),
            invoice_no="#34 UPPM", invoice_date=date(2026, 9, 19),
            lines=[{
                "po_line_id": line_id, "invoice_quantity": 5010, "invoice_rate": 31,
                "lots": [
                    {"source_reel_no": "UP-001", "net_weight_kg": 1250, "gross_weight_kg": 1270, "tare_weight_kg": 20, "width_mm": 120},
                    {"source_reel_no": "UP-002", "net_weight_kg": 1180, "gross_weight_kg": 1200, "tare_weight_kg": 20, "width_mm": 120},
                    {"source_reel_no": "UP-003", "net_weight_kg": 1320, "gross_weight_kg": 1340, "tare_weight_kg": 20, "width_mm": 120},
                    {"source_reel_no": "UP-004", "net_weight_kg": 1250, "gross_weight_kg": 1270, "tare_weight_kg": 20, "width_mm": 125},
                ],
            }],
        )
        first = post_governed_receipt(first_request, db, PLANT, MAKER)
        replay = post_governed_receipt(first_request, db, PLANT, MAKER)
        assert first["received_kg"] == 5000
        assert first["lot_count"] == 4
        assert replay["id"] == first["id"] and replay["idempotent"] is True
        assert len({row["at_no"] for row in first["created_lots"]}) == 4
        assert all(row["label"]["qr_value"].startswith("HARIOM|REEL|") for row in first["created_lots"])

        receipt = db.query(PurchaseReceipt).filter_by(id=uuid.UUID(first["id"])).one()
        receipt_line = receipt.lines[0]
        allocations = db.query(ReceiptStockAllocation).filter_by(receipt_line_id=receipt_line.id).all()
        assert len(allocations) == 4
        assert sum(Decimal(row.allocated_qty) for row in allocations) == Decimal("5000.000")
        reel_ids = [row.reel_id for row in allocations]
        assert db.query(PaperReel).filter(PaperReel.id.in_(reel_ids)).count() == 4
        assert db.query(LotLabelRecord).filter(LotLabelRecord.reel_id.in_(reel_ids)).count() == 4
        assert db.query(StockTransaction).filter(StockTransaction.reference_id == po["id"]).count() == 0

        label_request = LabelJobCreate(request_id=uuid.uuid4(), lot_ids=reel_ids, copies=1, profile="PAPER_LOT_4X2")
        label_job = create_label_job(label_request, db, PLANT, MAKER)
        label_replay = create_label_job(label_request, db, PLANT, MAKER)
        assert label_replay["id"] == label_job["id"] and label_replay["idempotent"] is True
        with pytest.raises(HTTPException) as changed_label_retry:
            create_label_job(label_request.model_copy(update={"copies": 2}), db, PLANT, MAKER)
        assert changed_label_retry.value.status_code == 409

        discrepancies = db.query(PurchaseDiscrepancy).order_by(PurchaseDiscrepancy.discrepancy_type).all()
        assert {row.discrepancy_type for row in discrepancies} == {"RATE", "QUANTITY", "SPECIFICATION"}
        rate_case = next(row for row in discrepancies if row.discrepancy_type == "RATE")
        qty_case = next(row for row in discrepancies if row.discrepancy_type == "QUANTITY")
        spec_case = next(row for row in discrepancies if row.discrepancy_type == "SPECIFICATION")
        assert rate_case.claimable_amount == Decimal("5000.00")
        assert qty_case.delta == Decimal("10.000000") and qty_case.claimable_amount == Decimal("0.00")

        note_request = DebitNoteCreate(request_id=uuid.uuid4(), note_date=date(2026, 9, 20),
            discrepancy_ids=[rate_case.id], reason="Vendor rate above approved PO")
        note = create_debit_note(note_request, db, PLANT, ACCOUNTS)
        note_replay = create_debit_note(note_request, db, PLANT, ACCOUNTS)
        assert note_replay["id"] == note["id"]
        with pytest.raises(HTTPException) as changed_note_retry:
            create_debit_note(note_request.model_copy(update={"reason": "Vendor rate changed after PO approval"}), db, PLANT, ACCOUNTS)
        assert changed_note_retry.value.status_code == 409
        note = act_on_debit_note(uuid.UUID(note["id"]), DebitNoteAction(action="SUBMIT", expected_version=note["version"]), db, PLANT, ACCOUNTS)
        with pytest.raises(HTTPException) as self_approval:
            act_on_debit_note(uuid.UUID(note["id"]), DebitNoteAction(action="APPROVE", expected_version=note["version"]), db, PLANT, ACCOUNTS)
        assert self_approval.value.status_code == 403
        note = act_on_debit_note(uuid.UUID(note["id"]), DebitNoteAction(action="APPROVE", expected_version=note["version"]), db, PLANT, CHECKER)
        note = act_on_debit_note(uuid.UUID(note["id"]), DebitNoteAction(action="ISSUE", expected_version=note["version"]), db, PLANT, ACCOUNTS)
        assert asyncio.run(_response_bytes(debit_note_pdf(uuid.UUID(note["id"]), db, PLANT, ACCOUNTS))).startswith(b"%PDF-")
        note = settle_debit_note(uuid.UUID(note["id"]), SettlementCreate(amount=2000, settlement_date=date(2026, 9, 25), reference="CN-1"), db, PLANT, ACCOUNTS)
        assert note["status"] == "PARTIALLY_SETTLED" and note["open_amount"] == 3000
        assert db.query(PurchaseDebitNote).count() == 1
        with pytest.raises(HTTPException) as settled_void:
            act_on_debit_note(uuid.UUID(note["id"]), DebitNoteAction(action="VOID", expected_version=note["version"], reason="Cannot void settled history"), db, PLANT, CHECKER)
        assert settled_void.value.status_code == 409

        with pytest.raises(HTTPException) as unresolved_release:
            act_on_discrepancy(
                rate_case.id, DiscrepancyAction(action="RELEASE_STOCK", expected_version=rate_case.version, reason="Claim issued; stock approved for use"),
                db, PLANT, CHECKER,
            )
        assert unresolved_release.value.status_code == 409
        act_on_discrepancy(
            qty_case.id, DiscrepancyAction(action="ACCEPT_VARIANCE", expected_version=qty_case.version, reason="Vendor quantity confirmed"),
            db, PLANT, CHECKER,
        )
        act_on_discrepancy(
            spec_case.id, DiscrepancyAction(action="ACCEPT_VARIANCE", expected_version=spec_case.version, reason="Measured width accepted by quality review"),
            db, PLANT, CHECKER,
        )
        released = act_on_discrepancy(
            rate_case.id, DiscrepancyAction(action="RELEASE_STOCK", expected_version=rate_case.version, reason="Claim issued; stock approved for use"),
            db, PLANT, CHECKER,
        )
        assert released["status"] == "CLAIMED"
        assert all(row.stock_status == "QC_HOLD" for row in db.query(PaperReel).filter(PaperReel.id.in_(reel_ids)).all())

        second_request = GovernedReceiptCreate(
            request_id=uuid.uuid4(), purchase_order_id=po["id"], received_date=date(2026, 9, 26),
            invoice_no=" #34 UPPM ", invoice_date=date(2026, 9, 19),
            lines=[{"po_line_id": line_id, "invoice_quantity": 5000, "invoice_rate": 30, "lots": [
                {"source_reel_no": f"UP-00{number}", "net_weight_kg": 1000, "width_mm": 120}
                for number in range(5, 10)
            ]}],
        )
        second = post_governed_receipt(second_request, db, PLANT, MAKER)
        assert second["lot_count"] == 5
        assert db.query(SupplierInvoice).count() == 1  # one invoice may cover multiple physical receipts
        saved_po = db.query(PurchaseOrder).filter_by(id=po["id"]).one()
        assert saved_po.status == "RECEIVED"
        assert saved_po.lines[0].qty_received == 10000
        assert saved_po.lines[0].received_unit_count == 9
        assert saved_po.lines[0].expected_unit_count == 8
        assert db.query(LotLabelRecord).join(PaperReel).filter(PaperReel.purchase_receipt_line_id.in_(
            [line.id for line in receipt.lines] + [line.id for line in db.query(PurchaseReceipt).filter_by(id=uuid.UUID(second["id"])).one().lines]
        )).count() == 9
        assert db.query(LabelPrintJob).count() == 1
    finally:
        db.close()


def test_concurrent_series_allocation_produces_distinct_ot_numbers():
    supplier_id = uuid.uuid4()

    def create_one(index):
        session = SessionLocal()
        try:
            payload = PurchaseOrderCreate(
                request_id=uuid.uuid4(), category="OT", supplier_id=supplier_id,
                supplier_name=f"Other Vendor {index}",
                lines=[{"item_id": _paper(session).id, "qty_ordered": 1, "unit_cost": 1, "uom": "KG"}],
            )
            return create_purchase_order(payload, session, PLANT, {**MAKER, "sub": f"maker{index}@example.com"})["po_no"]
        finally:
            session.close()

    with patch("src.routers.purchase.emit_audit_event"):
        with ThreadPoolExecutor(max_workers=2) as executor:
            numbers = sorted(executor.map(create_one, [1, 2]))
    assert numbers == ["OT/01", "OT/02"]


def test_owner_cost_history_stock_policy_mrp_and_plan_conversion():
    db = SessionLocal()
    owner = {"sub": "owner@example.com", "actual_sub": "owner@example.com", "roles": ["Owner"], "effective_roles": ["Owner"]}
    planner = {"sub": "planner@example.com", "roles": ["Planner"]}
    try:
        item = _paper(db)
        original_actual_cost = item.unit_cost
        first_cost_request = CostDraftCreate(
            request_id=uuid.uuid4(), item_id=item.id, base_cost=30, effective_from=date(2026, 9, 1),
            change_reason="Initial governed planning cost", source="Owner assumption",
            components=[
                {"component_type": "DISCOUNT", "label": "Discount", "calculation_mode": "PERCENT_BASE", "entered_value": 2},
                {"component_type": "FREIGHT", "label": "Freight", "calculation_mode": "PER_KG", "entered_value": 0.8},
                {"component_type": "UNLOADING", "label": "Unloading", "calculation_mode": "PER_KG", "entered_value": 0.2},
            ],
        )
        first = create_cost_draft(first_cost_request, db, PLANT, owner)
        sheet = db.query(RmCostSheet).filter_by(item_id=item.id).one()
        first = activate_cost_version(uuid.UUID(first["id"]), VersionAction(expected_version=sheet.version, reason="Initial governed planning cost"), db, PLANT, owner)
        assert first["landed_cost"] == 30.4
        first_replay = create_cost_draft(first_cost_request, db, PLANT, owner)
        assert first_replay["id"] == first["id"] and first_replay["status"] == "ACTIVE"
        with pytest.raises(HTTPException) as changed_cost_retry:
            create_cost_draft(first_cost_request.model_copy(update={"base_cost": 31}), db, PLANT, owner)
        assert changed_cost_retry.value.status_code == 409

        sheet = db.query(RmCostSheet).filter_by(id=sheet.id).one()
        second = create_cost_draft(CostDraftCreate(
            request_id=uuid.uuid4(), item_id=item.id, base_cost=32, effective_from=date(2026, 9, 1),
            change_reason="Reviewed paper base increase", source="Owner assumption", expected_sheet_version=sheet.version,
            components=[
                {"component_type": "DISCOUNT", "label": "Discount", "calculation_mode": "PERCENT_BASE", "entered_value": 2},
                {"component_type": "FREIGHT", "label": "Freight", "calculation_mode": "PER_KG", "entered_value": 0.8},
                {"component_type": "UNLOADING", "label": "Unloading", "calculation_mode": "PER_KG", "entered_value": 0.2},
            ],
        ), db, PLANT, owner)
        sheet = db.query(RmCostSheet).filter_by(id=sheet.id).one()
        second = activate_cost_version(uuid.UUID(second["id"]), VersionAction(expected_version=sheet.version, reason="Reviewed paper base increase"), db, PLANT, owner)
        assert second["landed_cost"] == 32.36
        versions = db.query(RmCostVersion).filter_by(sheet_id=sheet.id).order_by(RmCostVersion.version_no).all()
        assert [(row.version_no, row.status, row.landed_cost) for row in versions] == [
            (1, "SUPERSEDED", Decimal("30.400000")), (2, "ACTIVE", Decimal("32.360000")),
        ]
        db.refresh(item)
        assert item.unit_cost == original_actual_cost  # planning standards never rewrite inventory receipt cost

        policy_request = StockPolicyCreate(
            request_id=uuid.uuid4(), item_id=item.id, safety_stock_kg=500,
            reorder_point_kg=1000, target_stock_kg=10000, recovery_margin_kg=100,
            lead_time_days=7, minimum_order_kg=10000, order_multiple_kg=5000,
            recipients=["planner@example.com"], cooldown_hours=24,
            change_reason="Reviewed paper safety and replenishment levels",
        )
        policy = create_stock_policy(policy_request, db, PLANT, MAKER)
        assert create_stock_policy(policy_request, db, PLANT, MAKER)["id"] == policy["id"]
        with pytest.raises(HTTPException) as changed_policy_retry:
            create_stock_policy(policy_request.model_copy(update={"target_stock_kg": 12000}), db, PLANT, MAKER)
        assert changed_policy_retry.value.status_code == 409
        policy = activate_stock_policy(uuid.UUID(policy["id"]), VersionAction(expected_version=policy["version"], reason="Approved thresholds"), db, PLANT, CHECKER)
        assert policy["status"] == "ACTIVE"

        plan_request = PlanCreate(
            request_id=uuid.uuid4(), month=date(2026, 10, 1), name="October governed paper plan",
            source_hash="a" * 64, working_calendar={"sunday": "OFF"}, entries=[{
                "entry_date": date(2026, 10, 5), "item_id": item.id, "supplier_id": uuid.uuid4(),
                "supplier_name": "UPPM Paper Mill", "material_form": "COIL", "qty_kg": 12000,
                "expected_unit_count": 10, "notes": "Imported source evidence",
            }],
        )
        plan = create_plan(plan_request, db, PLANT, planner)
        assert create_plan(plan_request, db, PLANT, planner)["id"] == plan["id"]
        with pytest.raises(HTTPException) as changed_plan_retry:
            create_plan(plan_request.model_copy(update={"name": "Changed October plan"}), db, PLANT, planner)
        assert changed_plan_retry.value.status_code == 409
        plan = act_on_plan(uuid.UUID(plan["id"]), PlanStatusAction(action="SUBMIT", expected_version=plan["version"]), db, PLANT, planner)
        plan = act_on_plan(uuid.UUID(plan["id"]), PlanStatusAction(action="APPROVE", expected_version=plan["version"]), db, PLANT, CHECKER)
        request_id = uuid.uuid4()
        converted = convert_plan_to_purchase_orders(uuid.UUID(plan["id"]), PlanConversionInput(
            request_id=request_id, expected_plan_version=plan["version"], entry_ids=[uuid.UUID(plan["entries"][0]["id"])],
        ), db, PLANT, planner)
        replay = convert_plan_to_purchase_orders(uuid.UUID(plan["id"]), PlanConversionInput(
            request_id=request_id, expected_plan_version=plan["version"], entry_ids=[uuid.UUID(plan["entries"][0]["id"])],
        ), db, PLANT, planner)
        generated = db.query(PurchaseOrder).filter(PurchaseOrder.id == uuid.UUID(converted["purchase_order_ids"][0])).one()
        assert generated.status == "DRAFT" and generated.lines[0].unit_cost == pytest.approx(32.36)
        assert len(db.query(PurchaseOrderRevision).filter_by(purchase_order_id=generated.id).one().lines) == 1
        assert replay["idempotent"] is True and replay["purchase_order_ids"] == converted["purchase_order_ids"]

        mrp = run_mrp(MrpRunInput(
            as_of_date=date(2026, 9, 14), horizon_end=date(2026, 10, 31),
            demand_source_version=f"PLAN:{plan['id']}:V{plan['version']}", items=[{"item_id": item.id, "demand_kg": 99000}],
        ), db, PLANT, planner)
        result = mrp["results"][0]
        assert result["cost_status"] == "AVAILABLE" and result["cost_version"] == 2
        assert mrp["source_versions"]["policies"][str(item.id)] == 1
        assert db.query(StockAlertPolicy).filter_by(item_id=item.id, status="ACTIVE").count() == 1

        generated_revision = db.query(PurchaseOrderRevision).filter_by(purchase_order_id=generated.id).one()
        submitted = submit_purchase_order(
            generated.id,
            RevisionActionPayload(expected_version=generated.version, content_hash=generated_revision.content_hash, reason="Schedule accepted"),
            db, PLANT, planner,
        )
        approved = approve_purchase_order(
            generated.id,
            RevisionActionPayload(expected_version=submitted["version"], content_hash=generated_revision.content_hash, reason="Schedule approved"),
            db, PLANT, CHECKER,
        )
        closed = short_close_purchase_order(
            generated.id,
            ShortClosePayload(expected_version=approved["version"], reason="Supplier cannot deliver scheduled balance", lines=[]),
            db, PLANT, CHECKER,
        )
        schedule = db.query(PurchaseDeliverySchedule).filter_by(source_plan_entry_id=uuid.UUID(plan["entries"][0]["id"])).one()
        assert closed["status"] == "SHORT_CLOSED"
        assert schedule.cancelled_qty == Decimal("12000.000")
    finally:
        db.close()


def test_manual_multi_material_receipt_labels_and_independent_approval():
    from src.routers.manual_receipts import ManualReceiptCreate, post_manual_receipt, approve_manual_receipt
    from src.models import PurchaseOrderLine, StockBatch
    with SessionLocal() as db:
        item = _paper(db)
        supplier = uuid.uuid4()
        payload = ManualReceiptCreate(request_id=uuid.uuid4(), supplier_id=supplier, supplier_name="Manual mill",
            reason="Urgent material received without PO", received_date=date(2026, 9, 15), invoice_no=f"MAN-{uuid.uuid4().hex[:8]}", invoice_date=date(2026, 9, 15),
            lines=[{"item_id": item.id, "invoice_rate": 31, "incoming_qc_required": False,
                    "lots": [{"source_reel_no": "M001", "net_weight_kg": 650, "width_mm": 850, "physical_form": "REEL"},
                             {"source_reel_no": "M002", "net_weight_kg": 350, "width_mm": 100, "physical_form": "COIL"}]}])
        order_count = db.query(PurchaseOrder).count()
        result = post_manual_receipt(payload, db, PLANT, MAKER)
        assert result["purchase_order_id"] is None
        assert result["receipt_kind"] == "MANUAL"
        assert result["lot_count"] == 2 and result["received_kg"] == 1000
        assert db.query(PurchaseOrder).count() == order_count
        assert {row["stock_status"] for row in result["lots"]} == {"BLOCKED"}
        assert len({row["label"]["qr_value"] for row in result["lots"]}) == 2
        assert {row["label"]["width_mm"] for row in result["lots"]} == {850, 100}
        assert {row["label"]["physical_form"] for row in result["lots"]} == {"REEL", "COIL"}
        retry = post_manual_receipt(payload, db, PLANT, MAKER)
        assert retry["id"] == result["id"] and retry["idempotent"]
        action = VersionAction(expected_version=result["posting_version"], reason="Vendor invoice and receipt approved")
        with pytest.raises(HTTPException) as own:
            approve_manual_receipt(uuid.UUID(result["id"]), action, db, PLANT, MAKER)
        assert own.value.status_code == 409
        approved = approve_manual_receipt(uuid.UUID(result["id"]), action, db, PLANT, CHECKER)
        assert approved["commercial_status"] == "CLEAR"
        assert {row["stock_status"] for row in approved["lots"]} == {"QC_HOLD"}
        assert len(approved["approval_history"]) == 2


def test_manual_invoice_pending_attach_and_qc_remains_independent():
    from src.routers.manual_receipts import ManualReceiptCreate, post_manual_receipt, approve_manual_receipt
    from src.routers.procurement import AttachInvoiceRequest, attach_invoice_to_receipt
    with SessionLocal() as db:
        payload = ManualReceiptCreate(request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Challan mill",
            reason="Invoice arriving later", received_date=date(2026, 9, 15), invoice_pending=True,
            lines=[{"item_id": _paper(db).id, "lots": [{"source_reel_no": "WAIT-01", "net_weight_kg": 100, "width_mm": 800, "physical_form": "REEL"}]}])
        result = post_manual_receipt(payload, db, PLANT, MAKER)
        attached = attach_invoice_to_receipt(uuid.UUID(result["id"]), AttachInvoiceRequest(expected_version=1, invoice_no=f"LATE-{uuid.uuid4().hex[:8]}", invoice_date=date(2026, 9, 15), lines=[{"receipt_line_id": result["lines"][0]["id"], "invoice_rate": 35, "invoice_quantity": 100}]), db, PLANT, MAKER)
        assert attached["commercial_status"] == "MANUAL_REVIEW"
        approved = approve_manual_receipt(uuid.UUID(result["id"]), VersionAction(expected_version=2, reason="Late invoice verified"), db, PLANT, CHECKER)
        assert approved["lots"][0]["stock_status"] == "QC_HOLD"
        assert float(db.get(PaperReel, uuid.UUID(approved["lots"][0]["id"])).unit_cost) == 35


def test_manual_receipt_http_auth_roles_retry_and_cross_plant():
    import jwt
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.routers import procurement, manual_receipts
    from src.security.jwt_handler import SECRET_KEY
    app = FastAPI(); app.include_router(procurement.router)
    client = TestClient(app)
    def headers(role, actor, plant=PLANT):
        token = jwt.encode({"sub": actor, "role": role, "roles": [role], "actual_roles": [role], "plant_id": PLANT, "allowed_plants": [PLANT]}, SECRET_KEY, algorithm="HS256")
        return {"Authorization": f"Bearer {token}", "X-Plant-ID": plant}
    with SessionLocal() as db:
        item_id = str(_paper(db).id)
    body = {"request_id": str(uuid.uuid4()), "supplier_id": str(uuid.uuid4()), "supplier_name": "HTTP verified vendor", "reason": "Urgent manual purchase",
        "received_date": "2026-09-15", "invoice_no": f"HTTP-{uuid.uuid4().hex[:8]}", "invoice_date": "2026-09-15",
        "lines": [{"item_id": item_id, "invoice_rate": 31, "incoming_qc_required": False, "lots": [{"source_reel_no": "HTTP-R1", "net_weight_kg": 725, "width_mm": 500, "physical_form": "REEL"}]}]}
    assert client.post("/inventory/procurement/manual-receipts", json=body).status_code == 401
    assert client.post("/inventory/procurement/manual-receipts", json=body, headers=headers("Sales", "sales")).status_code == 403
    assert client.post("/inventory/procurement/manual-receipts", json=body, headers=headers("Store", "maker", "00000000-0000-0000-0000-0000000000b2")).status_code == 403
    response = client.post("/inventory/procurement/manual-receipts", json=body, headers=headers("Store", "maker"))
    assert response.status_code == 200, response.text
    saved = response.json(); assert saved["lots"][0]["stock_status"] == "BLOCKED"
    assert client.post("/inventory/procurement/manual-receipts", json=body, headers=headers("Store", "maker")).json()["idempotent"]
    changed = {**body, "reason": "Changed request contents"}
    assert client.post("/inventory/procurement/manual-receipts", json=changed, headers=headers("Store", "maker")).status_code == 409
    receipt_path = f"/inventory/procurement/receipts/{saved['id']}"
    assert client.get(receipt_path, headers=headers("Store", "maker")).json()["id"] == saved["id"]
    assert client.get(receipt_path, headers=headers("Store", "maker", "00000000-0000-0000-0000-0000000000b2")).status_code in {403, 404}
    register = client.get("/inventory/procurement/receipts", params={"q": saved["grn_no"], "receipt_kind": "MANUAL", "limit": 1}, headers=headers("Store", "maker"))
    assert register.status_code == 200 and register.json()["total"] == 1
    job = client.post("/inventory/procurement/label-jobs", json={"request_id": str(uuid.uuid4()), "lot_ids": [row["id"] for row in saved["lots"]], "copies": 1}, headers=headers("Store", "maker"))
    assert job.status_code == 200, job.text
    label_pdf = client.get(f"/inventory/procurement/label-jobs/{job.json()['id']}/pdf", headers=headers("Store", "maker"))
    assert label_pdf.status_code == 200 and label_pdf.content.startswith(b"%PDF")
    path = f"/inventory/procurement/receipts/{saved['id']}/approve-manual"
    action = {"expected_version": 1, "reason": "Invoice and goods checked"}
    assert client.post(path, json=action, headers=headers("Store", "maker")).status_code == 403
    assert client.post(path, json=action, headers=headers("Owner", "maker")).status_code == 409
    approved = client.post(path, json=action, headers=headers("Admin", "checker"))
    assert approved.status_code == 200, approved.text
    assert approved.json()["lots"][0]["stock_status"] == "QC_HOLD"
    assert client.post(path, json=action, headers=headers("Admin", "checker")).status_code == 409


def test_manual_quantity_discrepancy_cannot_bypass_purchase_approval():
    from src.routers.manual_receipts import ManualReceiptCreate, post_manual_receipt, approve_manual_receipt
    from src.models import ReceiptInvoiceAllocation, PurchaseReceiptLine
    with SessionLocal() as db:
        result = post_manual_receipt(ManualReceiptCreate(request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Quantity review mill",
            reason="Urgent non-PO receipt", received_date=date(2026, 9, 15), invoice_no=f"QTY-{uuid.uuid4().hex[:8]}", invoice_date=date(2026, 9, 15),
            lines=[{"item_id": _paper(db).id, "incoming_qc_required": False, "invoice_rate": 30, "invoice_quantity": 105,
                    "lots": [{"source_reel_no": "MAN-QTY-01", "net_weight_kg": 100, "width_mm": 800, "physical_form": "REEL"}]}]), db, PLANT, MAKER)
        case = db.query(PurchaseDiscrepancy).join(ReceiptInvoiceAllocation, ReceiptInvoiceAllocation.id == PurchaseDiscrepancy.allocation_id).join(PurchaseReceiptLine, PurchaseReceiptLine.id == ReceiptInvoiceAllocation.receipt_line_id).filter(PurchaseReceiptLine.receipt_id == result["id"]).one()
        assert case.discrepancy_type == "QUANTITY" and case.claimable_amount == Decimal("150")
        with pytest.raises(HTTPException, match="Resolve invoice quantity"):
            approve_manual_receipt(uuid.UUID(result["id"]), VersionAction(expected_version=1, reason="Received weight checked"), db, PLANT, CHECKER)
        decision = act_on_discrepancy(case.id, DiscrepancyAction(action="ACCEPT_VARIANCE", expected_version=case.version, reason="Weight tolerance accepted"), db, PLANT, CHECKER)
        assert decision["supplier_name"] == "Quantity review mill"
        saved = db.get(PurchaseReceipt, uuid.UUID(result["id"]))
        assert saved.commercial_status == "MANUAL_REVIEW"
        assert db.get(PaperReel, uuid.UUID(result["lots"][0]["id"])).stock_status == "BLOCKED"
        with pytest.raises(HTTPException, match="Approve the manual purchase"):
            act_on_discrepancy(case.id, DiscrepancyAction(action="RELEASE_STOCK", expected_version=case.version, reason="Release reviewed lot"), db, PLANT, CHECKER)
        approved = approve_manual_receipt(saved.id, VersionAction(expected_version=1, reason="Manual invoice authorized"), db, PLANT, CHECKER)
        assert approved["lots"][0]["stock_status"] == "QC_HOLD"


def test_delayed_invoice_retry_must_match_rates_and_quantities():
    from src.routers.manual_receipts import ManualReceiptCreate, post_manual_receipt
    from src.routers.procurement import AttachInvoiceRequest, attach_invoice_to_receipt
    with SessionLocal() as db:
        result = post_manual_receipt(ManualReceiptCreate(request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name="Retry mill", reason="Invoice pending delivery",
            received_date=date(2026, 9, 15), invoice_pending=True, lines=[{"item_id": _paper(db).id, "lots": [{"source_reel_no": "RETRY-01", "net_weight_kg": 120, "width_mm": 850, "physical_form": "REEL"}]}]), db, PLANT, MAKER)
        body = dict(expected_version=1, invoice_no=f"EXACT-{uuid.uuid4().hex[:8]}", invoice_date=date(2026, 9, 15), lines=[{"receipt_line_id": result["lines"][0]["id"], "invoice_rate": 32}])
        payload = AttachInvoiceRequest(**body)
        attach_invoice_to_receipt(uuid.UUID(result["id"]), payload, db, PLANT, MAKER)
        assert attach_invoice_to_receipt(uuid.UUID(result["id"]), payload, db, PLANT, MAKER)["idempotent"]
        for patch in ({"invoice_rate": 33}, {"invoice_quantity": 121}, {"tax_amount": 10}):
            changed = AttachInvoiceRequest(**{**body, "lines": [{**body["lines"][0], **patch}]})
            with pytest.raises(HTTPException) as error:
                attach_invoice_to_receipt(uuid.UUID(result["id"]), changed, db, PLANT, MAKER)
            assert error.value.status_code == 409


def test_mrp_flags_early_shortfall_even_when_month_end_po_covers_demand():
    with SessionLocal() as db, patch('src.routers.purchase.emit_audit_event'):
        item = ItemMaster(item_code=f'MRP-TIMING-{uuid.uuid4().hex[:8]}', name='Timing test adhesive', type='ADHESIVE', tracking_mode='BULK', uom='KG', plant_id=PLANT, active='true')
        db.add(item); db.commit()
        created = create_purchase_order(PurchaseOrderCreate(request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name='Late delivery mill', expected_date=date(2026,9,25), lines=[{'item_id':item.id,'qty_ordered':100,'unit_cost':30,'uom':'KG'}]), db, PLANT, MAKER)
        submitted = submit_purchase_order(created['id'], RevisionActionPayload(expected_version=created['version']), db, PLANT, MAKER)
        approve_purchase_order(created['id'], RevisionActionPayload(expected_version=submitted['version']), db, PLANT, CHECKER)
        from src.routers.purchase import SupplierScheduleCommit, commit_supplier_schedules
        order = db.get(PurchaseOrder, created['id'])
        commit_supplier_schedules(order.id, SupplierScheduleCommit(rows=[{
            'purchase_order_line_id': order.lines[0].id, 'scheduled_qty':100,
            'promised_date':date(2026,9,25), 'confirmation_status':'CONFIRMED'
        }]), db, PLANT, CHECKER)
        result = run_mrp(MrpRunInput(as_of_date=date(2026,9,1), horizon_end=date(2026,9,30), demand_source_version='test-dated-demand', items=[{'item_id':item.id,'demand_kg':100,'dated_demand':[{'date':'2026-09-10','qty_kg':100}]}]), db, PLANT, CHECKER)['results'][0]
        assert result['suggested_order_kg'] == 0
        assert result['peak_timing_shortfall_kg'] == 100
        assert result['first_shortage_date'] == '2026-09-10'
        assert result['daily_projection'][-1]['projected_free_kg'] == 0


def test_mrp_excludes_quality_held_stock_and_unconfirmed_or_overdue_supply():
    from src.models import StockBatch, TransactionType
    from src.routers.purchase import SupplierScheduleCommit, commit_supplier_schedules
    with SessionLocal() as db, patch('src.routers.purchase.emit_audit_event'):
        item = ItemMaster(item_code=f'MRP-QC-{uuid.uuid4().hex[:8]}', name='Held adhesive', type='ADHESIVE', tracking_mode='BULK', uom='KG', plant_id=PLANT, active='true')
        db.add(item); db.flush()
        batch = StockBatch(item_id=item.id, batch_no=uuid.uuid4().hex, received_qty=100, plant_id=PLANT, stock_status='QC_HOLD')
        db.add(batch); db.flush()
        db.add(StockTransaction(item_id=item.id, batch_id=batch.id, plant_id=PLANT, transaction_type=TransactionType.INWARD, qty_change=100, stock_status='QC_HOLD', reference_type='INTERNAL', reference_id=str(uuid.uuid4())))
        db.commit()
        created = create_purchase_order(PurchaseOrderCreate(request_id=uuid.uuid4(), supplier_id=uuid.uuid4(), supplier_name='Unconfirmed mill', expected_date=date(2026,9,1), lines=[{'item_id':item.id,'qty_ordered':100,'unit_cost':30,'uom':'KG'}]), db, PLANT, MAKER)
        submitted = submit_purchase_order(created['id'], RevisionActionPayload(expected_version=created['version']), db, PLANT, MAKER)
        approve_purchase_order(created['id'], RevisionActionPayload(expected_version=submitted['version']), db, PLANT, CHECKER)
        order = db.get(PurchaseOrder, created['id'])
        commit_supplier_schedules(order.id, SupplierScheduleCommit(rows=[
            {'purchase_order_line_id':order.lines[0].id,'scheduled_qty':40,'promised_date':date(2026,9,20),'confirmation_status':'TENTATIVE'},
            {'purchase_order_line_id':order.lines[0].id,'scheduled_qty':30,'promised_date':date(2026,8,20),'confirmation_status':'CONFIRMED'}
        ]), db, PLANT, CHECKER)
        result = run_mrp(MrpRunInput(as_of_date=date(2026,9,1),horizon_end=date(2026,9,30),demand_source_version='qc-test',items=[{'item_id':item.id,'demand_kg':100}]),db,PLANT,CHECKER)['results'][0]
        assert result['suggested_order_kg'] == 100
        assert result['unconfirmed_supply_kg'] == 40
        assert result['overdue_supply_kg'] == 30
        assert result['undated_open_supply_kg'] == 30
