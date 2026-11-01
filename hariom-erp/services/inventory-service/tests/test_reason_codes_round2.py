"""Reason inputs converted in the last pass (owner decision 4, 1 Nov 2026: master codes only, everywhere).

Incoming QC (INCOMING_QC), label reprints (LABEL_REPRINT), the AIT reel serial (REEL_SERIAL), stock alert
policies (STOCK_POLICY), RM cost drafts (RM_COST_CHANGE), purchase requisitions (PURCHASE_NEED), inward QC
band changes (QC_RULE_CHANGE, optional) and slitting card corrections (ENTRY_CORRECTION). Free text alone is
refused; a valid code is stored with its label and note. No database: the fake master in conftest.py answers.
"""
import uuid
from datetime import date
from types import SimpleNamespace

from _reason_fakes import OWNER, PLANT, FakeDB, FakeQuery, refused, spy_on
from src.models import ItemMaster, LabelPrintJob, LotLabelRecord, PurchaseRequisition, ReelIssue, StockBatch
from src.routers import procurement, quality, quality_standards, reel_issues, reel_serial, requisitions

QC = {"sub": "qc@hariom.com", "roles": ["QC"], "actual_roles": ["QC"], "token": "t"}
STORE = {"sub": "store@hariom.com", "roles": ["Store"], "token": "t"}
HEAD = {"sub": "head@hariom.com", "roles": ["PlantManager"], "token": "t"}


def _inspection(**extra):
    return quality.QualityInspectionCreate(entity_type="REEL", entity_id=uuid.uuid4(), readings={"gsm": 150}, **extra)


def test_incoming_qc_reason_is_an_incoming_qc_code(monkeypatch):
    spy = spy_on(monkeypatch, quality)
    # Free-text reasons for a failing check, a Hold or closing earlier holds are refused before any lookup.
    refused(lambda: quality.create_quality_inspection(_inspection(reasons={"gsm": "Light paper"}), FakeDB(), PLANT, QC),
            422, "this incoming QC result")
    refused(lambda: quality.create_quality_inspection(_inspection(disposition="HOLD", notes="Wet edges"), FakeDB(), PLANT, QC), 422)
    refused(lambda: quality.create_quality_inspection(_inspection(resolve_hold_ids=[uuid.uuid4()], notes="Re-checked ok"), FakeDB(), PLANT, QC), 422)
    refused(lambda: quality.create_quality_inspection(_inspection(disposition="REJECT", reason_code="IQ-OTHER", reason_note="wet"), FakeDB(), PLANT, QC),
            422, "at least 5")
    # A valid code passes the check; the reel lookup runs next (404: no such reel here).
    refused(lambda: quality.create_quality_inspection(_inspection(disposition="HOLD", reason_code="IQ-MOISTURE"), FakeDB(), PLANT, QC), 404)
    # Readings alone (no decision, no reason) need no code: an out-of-band reading is still saved and held.
    refused(lambda: quality.create_quality_inspection(_inspection(), FakeDB(), PLANT, QC), 404)
    assert set(spy.categories) == {"INCOMING_QC"}


class _LabelDB(FakeDB):
    """The label job looks up LabelPrintJob twice: the request-key replay (none here), then the print history."""

    def __init__(self, lot_id, printed_before):
        super().__init__({LotLabelRecord: [SimpleNamespace(reel_id=lot_id, content_snapshot={"at_no": "AIT 06243"})], StockBatch: []})
        self.history = [SimpleNamespace(lot_ids=[str(lot_id)])] if printed_before else []
        self.job_queries = 0

    def query(self, model, *rest):
        if model is LabelPrintJob:
            self.job_queries += 1
            return FakeQuery([] if self.job_queries % 2 else self.history)
        return super().query(model, *rest)


def test_label_reprint_needs_a_label_reprint_code(monkeypatch):
    spy = spy_on(monkeypatch, procurement)
    lot_id = uuid.uuid4()
    first = procurement.create_label_job(procurement.LabelJobCreate(request_id=uuid.uuid4(), lot_ids=[lot_id]), _LabelDB(lot_id, False), PLANT, STORE)
    assert first["idempotent"] is False
    refused(lambda: procurement.create_label_job(procurement.LabelJobCreate(request_id=uuid.uuid4(), lot_ids=[lot_id], reprint_reason="Torn"),
                                                 _LabelDB(lot_id, True), PLANT, STORE), 422, "printing these labels again")
    db = _LabelDB(lot_id, True)
    procurement.create_label_job(procurement.LabelJobCreate(request_id=uuid.uuid4(), lot_ids=[lot_id], reprint_reason_code="LR-DAMAGED",
                                                            reprint_reason_note="torn at the core"), db, PLANT, STORE)
    job = next(row for row in db.added if isinstance(row, LabelPrintJob))
    assert (job.reprint_reason_code, job.reprint_reason_label, job.reprint_reason_note) == ("LR-DAMAGED", "Lr damaged", "torn at the core")
    assert job.reprint_reason == "Lr damaged — torn at the core"
    assert spy.categories == ["LABEL_REPRINT"] * 3


def test_reel_serial_set_needs_a_reel_serial_code(monkeypatch):
    spy = spy_on(monkeypatch, reel_serial)
    refused(lambda: reel_serial.set_reel_serial(reel_serial.ReelSerialSet(next_number=6280, reason="Plant series"), FakeDB(), PLANT, OWNER),
            422, "setting the next reel number")
    refused(lambda: reel_serial.set_reel_serial(reel_serial.ReelSerialSet(next_number=6280, reason_code="RN-OTHER"), FakeDB(), PLANT, OWNER), 422, "at least 5")
    assert spy.categories == ["REEL_SERIAL", "REEL_SERIAL"]


def _policy(**extra):
    return procurement.StockPolicyCreate(request_id=uuid.uuid4(), item_id=uuid.uuid4(), safety_stock_kg=1, reorder_point_kg=2, target_stock_kg=3, **extra)


def test_stock_policy_and_cost_draft_need_codes(monkeypatch):
    spy = spy_on(monkeypatch, procurement)
    refused(lambda: procurement.create_stock_policy(_policy(change_reason="Usage went up"), FakeDB(), PLANT, STORE), 422, "this stock policy change")
    # With a code the policy goes on to the material lookup (404 here).
    refused(lambda: procurement.create_stock_policy(_policy(change_reason_code="SP-USAGE"), FakeDB(), PLANT, STORE), 404)
    item = SimpleNamespace(id=uuid.uuid4(), type="RAW_PAPER", uom="KG")
    draft = procurement.CostDraftCreate(request_id=uuid.uuid4(), item_id=item.id, base_cost=30, effective_from=date(2026, 11, 1), change_reason="Rate up")
    refused(lambda: procurement.create_cost_draft(draft, FakeDB({ItemMaster: [item]}), PLANT, OWNER), 422, "this cost change")
    assert spy.categories == ["STOCK_POLICY", "STOCK_POLICY", "RM_COST_CHANGE"]


def test_requisition_need_is_a_purchase_need_code(monkeypatch):
    spy = spy_on(monkeypatch, requisitions)
    item = SimpleNamespace(id=uuid.uuid4(), name="Core cutter blade", type="TOOL", uom="NOS")
    body = dict(request_id=uuid.uuid4(), pr_date=date(2026, 11, 1), item_id=item.id, quantity=2)
    refused(lambda: requisitions.create_requisition(requisitions.RequisitionCreate(**body, reason="Blade worn"),
                                                    FakeDB({ItemMaster: [item], PurchaseRequisition: []}), PLANT, STORE), 422, "why this purchase is needed")
    monkeypatch.setattr(requisitions, "_next_doc_no", lambda *args, **kwargs: "PR/26/001")
    db = FakeDB({ItemMaster: [item], PurchaseRequisition: []})
    saved = requisitions.create_requisition(requisitions.RequisitionCreate(**body, reason_code="PN-MAINT", reason_note="Blade worn"), db, PLANT, STORE)
    assert (saved["reason_code"], saved["reason_label"], saved["reason"]) == ("PN-MAINT", "Pn maint", "Pn maint — Blade worn")
    assert spy.categories == ["PURCHASE_NEED", "PURCHASE_NEED"]


def test_inward_band_change_reason_is_optional_but_never_free_text(monkeypatch):
    spy = spy_on(monkeypatch, quality_standards)
    payload = quality_standards.ToleranceSave(material_type="RAW_PAPER", scope="TYPE", note="supplier agreed GSM ±4%")
    refused(lambda: quality_standards.save_tolerances(payload, FakeDB(), OWNER), 422, "Masters › Reason codes")
    refused(lambda: quality_standards.save_tolerances(payload.model_copy(update={"note": "", "reason_code": "QV-OTHER"}), FakeDB(), OWNER), 422, "at least 5")
    assert spy.categories == ["QC_RULE_CHANGE"]


def test_slitting_card_correction_needs_an_entry_correction_code(monkeypatch):
    spy = spy_on(monkeypatch, reel_issues)
    issue = SimpleNamespace(id=uuid.uuid4(), issue_mode="FLOOR", issue_section="SLITTING_SECTION", issued_weight_kg=1000,
                            slitting_card={"coils_made": 6, "wastage_kg": 12}, issue_date=date(2026, 11, 1), shift="A")
    payload = reel_issues.SlittingCardPayload(coils_made=7, wastage_kg=10, correction_reason="Recounted coils")
    refused(lambda: reel_issues.record_slitting_card(issue.id, payload, FakeDB({ReelIssue: [issue]}), PLANT, HEAD), 422, "correcting the slitting card")
    assert spy.categories == ["ENTRY_CORRECTION"]
