"""Purchase reasons pick a code from Masters › Reason codes (owner decision 4, 1 Nov 2026).

PO reject / cancel / short close / revision, requisition and plan reject, invoice differences, debit notes,
supplier schedule changes, RM calendar cancel, over-receipt and the GRN rejected remainder: free text alone
is refused, a valid code is stored with its label and note, and "Label — note" goes into the old text field.
"""
import uuid
from datetime import date, timedelta
from types import SimpleNamespace

import pytest

from _reason_fakes import OWNER, PLANT, FakeDB, refused, spy_on
from src.models import (
    ProcurementPlan,
    PurchaseDebitNote,
    PurchaseDiscrepancy,
    PurchaseLineSchedule,
    PurchaseOrder,
    PurchaseReceiptLine,
    PurchaseRequisition,
    ReceiptInvoiceAllocation,
)
from src.routers import procurement, purchase, requisitions
from src.services import books as books_service


def _order(**extra):
    base = dict(id=uuid.uuid4(), plant_id=PLANT, version=3, status="SUBMITTED", metadata_json={}, lines=[], po_no="PO/1")
    base.update(extra)
    return SimpleNamespace(**base)


def _revision():
    return SimpleNamespace(id=uuid.uuid4(), content_hash="h" * 64, version=1, approval_state="SUBMITTED",
                           rejected_by=None, rejected_at=None, rejection_reason=None)


@pytest.fixture
def po_reject(monkeypatch):
    revision = _revision()
    monkeypatch.setattr(purchase, "_current_revision", lambda db, order, lock=False: revision)
    monkeypatch.setattr(purchase, "_serialize_order", lambda order: order)
    return revision


# ---------------------------------------------------------------- PO reject (PURCHASE_REJECT)

def test_po_reject_refuses_free_text_and_stores_code_label_note(monkeypatch, po_reject):
    spy = spy_on(monkeypatch, purchase)
    order = _order()
    db = FakeDB({PurchaseOrder: [order]})
    payload = purchase.RevisionActionPayload(expected_version=3, reason="Rate is too high")
    refused(lambda: purchase.reject_purchase_order(order.id, payload, db, PLANT, OWNER), 422, "Choose a reason")
    assert order.status == "SUBMITTED" and db.commits == 0

    payload = purchase.RevisionActionPayload(expected_version=3, reason_code="pj-rate-high", reason_note="₹4 over last PO")
    purchase.reject_purchase_order(order.id, payload, db, PLANT, OWNER)
    assert spy.categories[-1] == "PURCHASE_REJECT"
    assert order.status == "REJECTED"
    assert po_reject.rejection_reason == "Pj rate high — ₹4 over last PO"
    assert (po_reject.rejection_reason_code, po_reject.rejection_reason_label, po_reject.rejection_reason_note) == (
        "PJ-RATE-HIGH", "Pj rate high", "₹4 over last PO")
    assert order.metadata_json["rejection_reason_code"] == "PJ-RATE-HIGH"
    assert db.added[-1].reason == "Pj rate high — ₹4 over last PO"


def test_po_reject_other_needs_a_note_and_a_non_decider_is_refused_first(monkeypatch, po_reject):
    order = _order()
    db = FakeDB({PurchaseOrder: [order]})
    refused(lambda: purchase.reject_purchase_order(order.id, purchase.RevisionActionPayload(expected_version=3, reason_code="PJ-OTHER", reason_note="no"),
                                                   db, PLANT, OWNER), 422, "at least 5")
    store = {"sub": "store@hariom.com", "roles": ["Store"], "token": "t"}
    refused(lambda: purchase.reject_purchase_order(order.id, purchase.RevisionActionPayload(expected_version=3), db, PLANT, store), 403)


# ---------------------------------------------------------------- PO cancel / short close (PO_CLOSE)

def test_po_cancel_needs_a_po_close_code(monkeypatch):
    spy = spy_on(monkeypatch, purchase)
    monkeypatch.setattr(purchase, "_serialize_order", lambda order: order)
    order = _order(status="APPROVED")
    db = FakeDB({PurchaseOrder: [order]})
    refused(lambda: purchase.cancel_purchase_order(order.id, purchase.RevisionActionPayload(expected_version=3, reason="Not needed any more"),
                                                   db, PLANT, OWNER), 422)
    refused(lambda: purchase.cancel_purchase_order(order.id, purchase.RevisionActionPayload(expected_version=3, reason_code="PC-OTHER"),
                                                   db, PLANT, OWNER), 422, "at least 5")
    purchase.cancel_purchase_order(order.id, purchase.RevisionActionPayload(expected_version=3, reason_code="PC-DUPLICATE", reason_note="Made twice"),
                                   db, PLANT, OWNER)
    assert spy.categories[-1] == "PO_CLOSE" and order.status == "CANCELLED"
    meta = order.metadata_json
    assert meta["cancellation_reason"] == "Pc duplicate — Made twice"
    assert (meta["cancellation_reason_code"], meta["cancellation_reason_label"], meta["cancellation_reason_note"]) == ("PC-DUPLICATE", "Pc duplicate", "Made twice")


def test_po_short_close_needs_a_po_close_code(monkeypatch):
    spy = spy_on(monkeypatch, purchase)
    monkeypatch.setattr(purchase, "_serialize_order", lambda order: order)
    line = SimpleNamespace(id=uuid.uuid4(), qty_ordered=100.0, qty_received=40.0, qty_short_closed=0.0, line_status="PARTIAL")
    order = _order(status="PARTIALLY_RECEIVED", lines=[line])
    db = FakeDB({PurchaseOrder: [order], PurchaseLineSchedule: []})
    refused(lambda: purchase.short_close_purchase_order(order.id, purchase.ShortClosePayload(expected_version=3, reason="Mill cannot supply"),
                                                        db, PLANT, OWNER), 422)
    assert line.qty_short_closed == 0.0
    purchase.short_close_purchase_order(order.id, purchase.ShortClosePayload(expected_version=3, reason_code="PC-SUPPLIER-CANNOT"), db, PLANT, OWNER)
    assert spy.categories[-1] == "PO_CLOSE" and line.qty_short_closed == 60.0
    meta = order.metadata_json
    assert meta["short_close_reason"] == "Pc supplier cannot" and meta["short_close_reason_code"] == "PC-SUPPLIER-CANNOT"
    assert meta["short_close_reason_note"] is None


# ---------------------------------------------------------------- GRN rejected remainder (RM_ISSUE, optional)

def test_rejected_remainder_reason_is_optional_but_checked_when_sent():
    payload = purchase.RejectRemainderPayload(qty_rejected=5)
    assert purchase._reason_choice(payload, "RM_ISSUE", PLANT, OWNER, "the rejected remainder", required=False) is None
    choice = purchase._reason_choice(purchase.RejectRemainderPayload(qty_rejected=5, reason_code="RM-DAMAGED"), "RM_ISSUE", PLANT, OWNER,
                                     "the rejected remainder", required=False)
    assert choice.code == "RM-DAMAGED" and choice.label == "Rm damaged"
    refused(lambda: purchase._reason_choice(purchase.RejectRemainderPayload(qty_rejected=5, reason_code="BAD-X"), "RM_ISSUE", PLANT, OWNER,
                                            "the rejected remainder", required=False), 422, "not in the RM_ISSUE list")


# ---------------------------------------------------------------- supplier schedule change (SUPPLIER_SCHEDULE)

def test_supplier_schedule_change_needs_a_code_and_keeps_it_in_the_history(monkeypatch):
    spy = spy_on(monkeypatch, purchase)
    monkeypatch.setattr(purchase, "serialize_schedule", lambda row, db: row)
    today = books_service.ist_today()
    row = SimpleNamespace(id=uuid.uuid4(), version=1, confirmation_status="TENTATIVE", current_date=today, change_history=[], notes=None,
                          scheduled_qty=10.0, received_qty=0.0, cancelled_qty=0.0, cancelled_at=None,
                          order_line=SimpleNamespace(order=SimpleNamespace(status="APPROVED")))
    db = FakeDB({PurchaseLineSchedule: [row]})
    later = today + timedelta(days=3)
    refused(lambda: purchase.update_supplier_schedule(row.id, purchase.SupplierScheduleUpdate(
        expected_version=1, current_date=later, confirmation_status="TENTATIVE", reason="Mill asked"), db, PLANT, OWNER), 422)
    purchase.update_supplier_schedule(row.id, purchase.SupplierScheduleUpdate(
        expected_version=1, current_date=later, confirmation_status="TENTATIVE", reason_code="SCH-SUPPLIER-DELAY", reason_note="Mill asked"), db, PLANT, OWNER)
    assert spy.categories[-1] == "SUPPLIER_SCHEDULE"
    entry = row.change_history[-1]
    assert entry["reason"] == "Sch supplier delay — Mill asked" and entry["reason_code"] == "SCH-SUPPLIER-DELAY"
    assert entry["reason_label"] == "Sch supplier delay" and row.notes == "Sch supplier delay — Mill asked"

    # The vendor confirming the same date is not a change: no code needed.
    purchase.update_supplier_schedule(row.id, purchase.SupplierScheduleUpdate(
        expected_version=row.version, current_date=later, confirmation_status="CONFIRMED"), db, PLANT, OWNER)
    assert row.change_history[-1]["reason"] == "Vendor confirmed" and "reason_code" not in row.change_history[-1]


# ---------------------------------------------------------------- RM calendar cancel (SUPPLIER_SCHEDULE, now required)

def test_calendar_cancel_asks_for_the_code_only_after_the_permission_check(monkeypatch):
    spy = spy_on(monkeypatch, procurement)
    seen = {}

    def fake_cancel(db, plant_id, entry_id, actor, *, is_owner, reason=None, choose_reason=None):
        choice = choose_reason()
        seen.update(code=choice.code, text=choice.text)
        return SimpleNamespace(id=entry_id)

    monkeypatch.setattr(procurement.rm_calendar, "cancel_entry", fake_cancel)
    monkeypatch.setattr(procurement.rm_calendar, "entry_payload", lambda entry: {"id": str(entry.id)})
    db = FakeDB()
    refused(lambda: procurement.calendar_cancel(uuid.uuid4(), procurement.CalendarEntryCancel(reason="Not needed"), db, PLANT, OWNER), 422)
    procurement.calendar_cancel(uuid.uuid4(), procurement.CalendarEntryCancel(reason_code="SCH-STOCK-OK"), db, PLANT, OWNER)
    assert spy.categories[-1] == "SUPPLIER_SCHEDULE" and seen == {"code": "SCH-STOCK-OK", "text": "Sch stock ok"}


# ---------------------------------------------------------------- requisition and purchase plan reject (PURCHASE_REJECT)

def _requisition():
    return SimpleNamespace(id=uuid.uuid4(), pr_no="PR/1", pr_date=date(2026, 11, 1), item_id=uuid.uuid4(), item_name="Kraft", quantity=5,
                           uom="KG", reason="Need it", requested_by="store", status="SUBMITTED", version=1, decided_by=None, decided_at=None,
                           decision_reason=None, purchase_order_id=None, history=[], plant_id=PLANT)


def test_requisition_reject_needs_a_code_and_approve_needs_none(monkeypatch):
    spy = spy_on(monkeypatch, requisitions)
    row = _requisition()
    db = FakeDB({PurchaseRequisition: [row]})
    owner = {**OWNER, "sub": "owner@hariom.com"}
    refused(lambda: requisitions.decide_requisition(row.id, requisitions.RequisitionDecision(expected_version=1, decision="REJECTED", reason="Not now"),
                                                    db, PLANT, owner), 422)
    refused(lambda: requisitions.decide_requisition(row.id, requisitions.RequisitionDecision(expected_version=1, decision="REJECTED", reason_code="PJ-OTHER"),
                                                    db, PLANT, owner), 422, "at least 5")
    result = requisitions.decide_requisition(row.id, requisitions.RequisitionDecision(
        expected_version=1, decision="REJECTED", reason_code="PJ-STOCK-OK", reason_note="3 t in store"), db, PLANT, owner)
    assert spy.categories == ["PURCHASE_REJECT"] * 3
    assert result["decision_reason"] == "Pj stock ok — 3 t in store"
    assert result["history"][-1]["reason_code"] == "PJ-STOCK-OK" and result["history"][-1]["reason_label"] == "Pj stock ok"

    second = _requisition()
    approved = requisitions.decide_requisition(second.id, requisitions.RequisitionDecision(expected_version=1, decision="APPROVED"),
                                               FakeDB({PurchaseRequisition: [second]}), PLANT, owner)
    assert approved["status"] == "APPROVED" and approved["decision_reason"] == "Approved" and len(spy.categories) == 3


def test_purchase_plan_reject_needs_a_code(monkeypatch):
    spy = spy_on(monkeypatch, procurement)
    monkeypatch.setattr(procurement, "_plan_payload", lambda plan: plan)
    plan = SimpleNamespace(id=uuid.uuid4(), plant_id=PLANT, version=2, status="SUBMITTED", created_by="planner", working_calendar={"a": 1})
    db = FakeDB({ProcurementPlan: [plan]})
    planner = {"sub": "head@hariom.com", "roles": ["PlantManager"], "token": "t"}
    refused(lambda: procurement.act_on_plan(plan.id, procurement.PlanStatusAction(action="REJECT", expected_version=2, reason="Too much"), db, PLANT, planner), 422)
    procurement.act_on_plan(plan.id, procurement.PlanStatusAction(action="REJECT", expected_version=2, reason_code="PJ-BUDGET"), db, PLANT, planner)
    assert spy.categories[-1] == "PURCHASE_REJECT" and plan.status == "REJECTED"
    assert plan.working_calendar["a"] == 1 and plan.working_calendar["rejection"]["reason_code"] == "PJ-BUDGET"
    assert plan.working_calendar["rejection"]["reason"] == "Pj budget"


# ---------------------------------------------------------------- invoice differences (INVOICE_DIFF)

def _discrepancy_db():
    receipt = SimpleNamespace(created_by="maker", approval_history=[], receipt_kind="PO_LINKED", invoice_pending=False)
    line = SimpleNamespace(id=uuid.uuid4(), receipt=receipt)
    row = SimpleNamespace(id=uuid.uuid4(), plant_id=PLANT, version=1, allocation_id=uuid.uuid4(), status="OPEN", evidence_json={"x": 1},
                          resolution_reason=None, invoice_rate=31, po_rate=30, assignee=None, discrepancy_type="RATE")
    allocation = SimpleNamespace(id=row.allocation_id, receipt_line_id=line.id)
    return row, receipt, FakeDB({PurchaseDiscrepancy: [row], ReceiptInvoiceAllocation: [allocation], PurchaseReceiptLine: [line]})


def test_invoice_difference_needs_a_code_except_assign(monkeypatch):
    spy = spy_on(monkeypatch, procurement)
    monkeypatch.setattr(procurement, "_discrepancy_payload", lambda row, db: row)
    head = {"sub": "head@hariom.com", "roles": ["PlantManager"], "token": "t"}
    row, receipt, db = _discrepancy_db()
    refused(lambda: procurement.act_on_discrepancy(row.id, procurement.DiscrepancyAction(action="REJECT_INVOICE", expected_version=1, reason="Wrong bill"),
                                                   db, PLANT, head), 422)
    procurement.act_on_discrepancy(row.id, procurement.DiscrepancyAction(action="REJECT_INVOICE", expected_version=1, reason_code="ID-WRONG-INVOICE",
                                                                         reason_note="Bill of another GRN"), db, PLANT, head)
    assert spy.categories == ["INVOICE_DIFF", "INVOICE_DIFF"]
    assert row.resolution_reason == "Id wrong invoice — Bill of another GRN"
    assert row.evidence_json == {"x": 1, "resolution_reason_code": "ID-WRONG-INVOICE", "resolution_reason_label": "Id wrong invoice",
                                 "resolution_reason_note": "Bill of another GRN"}
    assert receipt.approval_history[-1]["reason_code"] == "ID-WRONG-INVOICE"

    row, receipt, db = _discrepancy_db()
    procurement.act_on_discrepancy(row.id, procurement.DiscrepancyAction(action="ASSIGN", expected_version=1, assignee="accounts@hariom.com"),
                                   db, PLANT, head)
    assert row.status == "UNDER_REVIEW" and len(spy.categories) == 2
    assert receipt.approval_history[-1]["reason"] == "Assigned to accounts@hariom.com"


# ---------------------------------------------------------------- debit notes (DEBIT_NOTE)

def test_debit_note_raise_and_void_need_a_code(monkeypatch):
    spy = spy_on(monkeypatch, procurement)
    monkeypatch.setattr(procurement, "_debit_payload", lambda note: note)
    accounts = {"sub": "accounts@hariom.com", "roles": ["Accounts"], "token": "t"}
    refused(lambda: procurement.create_debit_note(procurement.DebitNoteCreate(
        request_id=uuid.uuid4(), note_date=date(2026, 11, 1), discrepancy_ids=[uuid.uuid4()], reason="Rate claim"), FakeDB(), PLANT, accounts), 422)
    refused(lambda: procurement.create_debit_note(procurement.DebitNoteCreate(
        request_id=uuid.uuid4(), note_date=date(2026, 11, 1), discrepancy_ids=[uuid.uuid4()], reason_code="DN-OTHER", reason_note="x"), FakeDB(), PLANT, accounts),
        422, "at least 5")

    note = SimpleNamespace(id=uuid.uuid4(), plant_id=PLANT, version=1, status="ISSUED", settled_amount=0, lines=[], debit_note_no="DN/1",
                           created_by="accounts", void_reason=None, void_reason_code=None, void_reason_label=None, void_reason_note=None)
    db = FakeDB({PurchaseDebitNote: [note]})
    refused(lambda: procurement.act_on_debit_note(note.id, procurement.DebitNoteAction(action="VOID", expected_version=1, reason="Mistake"), db, PLANT, accounts), 422)
    assert note.status == "ISSUED"
    procurement.act_on_debit_note(note.id, procurement.DebitNoteAction(action="VOID", expected_version=1, reason_code="DN-VOID-ERROR"), db, PLANT, accounts)
    assert spy.categories[-1] == "DEBIT_NOTE" and note.status == "VOID"
    assert (note.void_reason, note.void_reason_code, note.void_reason_label) == ("Dn void error", "DN-VOID-ERROR", "Dn void error")


# ---------------------------------------------------------------- over-receipt on a GRN (OVER_RECEIPT)

def test_over_receipt_needs_a_code_not_just_text():
    payload = SimpleNamespace(over_receipt_reason="Full drum", over_receipt_reason_code=None, over_receipt_reason_note=None)
    refused(lambda: procurement._over_receipt_choice(payload, PLANT, OWNER), 422, "receiving more than the PO")
    payload = SimpleNamespace(over_receipt_reason=None, over_receipt_reason_code="OR-OTHER", over_receipt_reason_note="abc")
    refused(lambda: procurement._over_receipt_choice(payload, PLANT, OWNER), 422, "at least 5")
    payload = SimpleNamespace(over_receipt_reason=None, over_receipt_reason_code="or-roll-weight", over_receipt_reason_note="Reel 1161 kg")
    choice = procurement._over_receipt_choice(payload, PLANT, OWNER)
    assert (choice.code, choice.label, choice.text) == ("OR-ROLL-WEIGHT", "Or roll weight", "Or roll weight — Reel 1161 kg")
    assert "Choose a reason" in procurement._over_receipt_text(1, "KRAFT", procurement.Decimal("55"), procurement.Decimal("40"), "KG")


# ---------------------------------------------------------------- PO revision (PO_REVISION)

def test_po_revision_refuses_a_typed_change_reason_without_a_code():
    supplier = uuid.uuid4()
    order = _order(status="APPROVED", category="RM", receipts=[], supplier_id=supplier, approved_at=None)
    db = FakeDB({PurchaseOrder: [order]})
    typed = SimpleNamespace(expected_version=3, category="RM", supplier_id=supplier, change_reason="More quantity", reason_code=None, reason_note=None)
    refused(lambda: purchase.create_purchase_order_revision(order.id, typed, db, PLANT, OWNER), 422, "the PO change")
    other = SimpleNamespace(expected_version=3, category="RM", supplier_id=supplier, change_reason=None, reason_code="PV-OTHER", reason_note="qty")
    refused(lambda: purchase.create_purchase_order_revision(order.id, other, db, PLANT, OWNER), 422, "at least 5")
    assert purchase.PurchaseRevisionCreate.model_fields["change_reason"].is_required() is False


def test_editing_a_never_approved_draft_asks_no_reason():
    supplier = uuid.uuid4()
    order = _order(status="DRAFT", category="RM", receipts=[], supplier_id=supplier, approved_at=None)
    db = FakeDB({PurchaseOrder: [order], purchase.PurchaseOrderRevision.id: []})
    payload = SimpleNamespace(expected_version=3, category="RM", supplier_id=supplier, change_reason=None, reason_code=None, reason_note=None, lines=[])
    # Past the reason check: the handler goes on to read the PO form (this stand-in payload has no vendor terms).
    with pytest.raises(AttributeError):
        purchase.create_purchase_order_revision(order.id, payload, db, PLANT, OWNER)
    approved_before = FakeDB({PurchaseOrder: [order], purchase.PurchaseOrderRevision.id: [uuid.uuid4()]})
    refused(lambda: purchase.create_purchase_order_revision(order.id, payload, approved_before, PLANT, OWNER), 422, "the PO change")
