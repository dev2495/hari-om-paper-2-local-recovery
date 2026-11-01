"""Reasons on the batch-entry floor and the old-form stage completion are Masters › Reason codes only
(owner decision 4, 1 Nov 2026): floor rejection (SCRAP), overrides (OVERRIDE), entry corrections
(ENTRY_CORRECTION) and an old-form stage completed below plan (STAGE_SHORT_CLOSE).

Free text alone is refused, a valid code is stored with its label at the time, its note and the old
"Label — note" text, an OTHER code needs a note, a code of another list is refused, and rejected pieces
without a code are refused. Master data is replaced by a stub that applies the real helper's rules.
The close / void / reopen endpoints themselves are covered against PostgreSQL in test_continuous_entries.
"""
import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.reasons import ReasonChoice, reason_needs_note
from src.routers import entries, planning

PLANT = uuid.uuid4()
JOB = SimpleNamespace(plant_id=PLANT)
LISTS = {
    "SCRAP": {"WL": "Winding loose", "DM": "Damage / dent", "RJ-OTHER": "Other (write a note)"},
    "OVERRIDE": {"OV-CUST-EXTRA": "Customer accepts extra", "OV-OTHER": "Other (write a note)"},
    "ENTRY_CORRECTION": {"EC-WRONG-QTY": "Wrong quantity entered"},
    "STAGE_SHORT_CLOSE": {"SS-MATERIAL-SHORT": "Paper or input short", "SS-OTHER": "Other (write a note)"},
}


@pytest.fixture
def master(monkeypatch):
    calls = []

    def resolve(*, category, code, note=None, plant_id=None, token=None, required=True, what="this"):
        calls.append({"category": category, "code": code, "note": note, "plant_id": plant_id, "token": token})
        wanted = str(code or "").strip().upper()
        if not wanted:
            if not required:
                return None
            raise HTTPException(status_code=422, detail=f"Choose a reason for {what} from the list (Masters › Reason codes).")
        if reason_needs_note(wanted) and len(str(note or "").strip()) < 5:
            raise HTTPException(status_code=422, detail="Write a short note (at least 5 characters) when the reason is Other.")
        if wanted not in LISTS.get(category, {}):
            raise HTTPException(status_code=422, detail=f"{wanted} is not in the {category} list.")
        return ReasonChoice(category, wanted, LISTS[category][wanted], str(note or "").strip() or None)

    monkeypatch.setattr(entries, "resolve_reason", resolve)
    import src.reasons as reasons
    monkeypatch.setattr(reasons, "resolve_reason", resolve)
    return calls


def run(**overrides):
    values = dict(kind="PRODUCTION", produced=10, accepted=8, rejected=2, input_quantity=0, cutting_loss_pcs=0, carry_in_pcs=0, carry_out_pcs=0,
                  samples=[], business_date=date(2026, 10, 30), shift_code="SHIFT_A", operator_id="op", stage="WINDER", details={})
    values.update(overrides)
    return SimpleNamespace(**values)


# ── Floor rejection (SCRAP) ─────────────────────────────────────────────


def test_rejected_pieces_with_free_text_only_are_refused(master):
    e = run(details={"reject_reason": "Loose winding on three"})
    with pytest.raises(HTTPException) as refused:
        entries.validate_entry(e, JOB, "t")
    assert refused.value.status_code == 422 and "rejected or lost pieces" in refused.value.detail


def test_rejected_pieces_without_any_reason_are_refused(master):
    with pytest.raises(HTTPException) as refused:
        entries.validate_entry(run(), JOB, "t")
    assert refused.value.status_code == 422


def test_valid_rejection_code_stores_code_label_note_and_old_text(master):
    e = run(details={"reject_code": "wl", "reject_note": "three bamboo", "reject_reason": "Winding loose — three bamboo"})
    entries.validate_entry(e, JOB, "tok")
    d = e.details
    assert (d["reject_code"], d["reject_label"], d["reject_note"], d["reject_reason"]) == ("WL", "Winding loose", "three bamboo", "Winding loose — three bamboo")
    assert master[-1] == {"category": "SCRAP", "code": "WL", "note": "three bamboo", "plant_id": PLANT, "token": "tok"}


def test_cutting_loss_needs_a_rejection_code_and_fills_the_cutting_loss_text(master):
    e = run(stage="PROCESS", produced=10, accepted=10, rejected=0, cutting_loss_pcs=3, details={"reject_code": "DM", "reject_note": None})
    entries.validate_entry(e, JOB)
    assert e.details["reject_reason"] == "Damage / dent" and e.details["cutting_loss_reason"] == "Damage / dent"
    with pytest.raises(HTTPException):
        entries.validate_entry(run(stage="PROCESS", accepted=10, rejected=0, cutting_loss_pcs=3, details={"cutting_loss_reason": "trim"}), JOB)


def test_old_other_code_is_rj_other_and_needs_a_note(master):
    with pytest.raises(HTTPException) as refused:
        entries.validate_entry(run(details={"reject_code": "OT", "reject_note": "bad"}), JOB)
    assert refused.value.status_code == 422 and "note" in refused.value.detail
    e = run(details={"reject_code": "OT", "reject_note": "paper torn at the edge"})
    entries.validate_entry(e, JOB)
    assert e.details["reject_code"] == "RJ-OTHER" and e.details["reject_reason"] == "Other (write a note) — paper torn at the edge"


def test_old_draft_text_becomes_the_note_and_a_checked_run_is_not_doubled(master):
    # A draft saved before 1 Nov kept the code and text only: the text is the note.
    e = run(details={"reject_code": "WL", "reject_reason": "three bamboo"})
    entries.validate_entry(e, JOB)
    assert e.details["reject_reason"] == "Winding loose — three bamboo"
    entries.validate_entry(e, JOB)  # checked again (submit after edit): the note stays the note
    assert e.details["reject_reason"] == "Winding loose — three bamboo"


def test_a_code_from_another_list_is_refused(master):
    with pytest.raises(HTTPException) as refused:
        entries.validate_entry(run(details={"reject_code": "OV-CUST-EXTRA"}), JOB)
    assert refused.value.status_code == 422 and "SCRAP" in refused.value.detail


# ── Overrides (OVERRIDE) ───────────────────────────────────────────────


def test_override_with_free_text_only_is_refused(master):
    e = run(details={"overproduction_reason": "Customer takes extra"})
    with pytest.raises(HTTPException) as refused:
        entries.resolve_override(e, JOB, "overproduction_reason")
    assert refused.value.status_code == 422 and "110%" in refused.value.detail


def test_override_own_code_is_stored_with_label_note_and_text(master):
    e = run(details={"carryover_reason_code": "OV-OTHER", "carryover_reason_note": "held for the next shift"})
    entries.resolve_override(e, JOB, "carryover_reason", "tok")
    d = e.details
    assert (d["carryover_reason"], d["carryover_reason_code"], d["carryover_reason_label"], d["carryover_reason_note"]) == (
        "Other (write a note) — held for the next shift", "OV-OTHER", "Other (write a note)", "held for the next shift")


def test_one_shared_override_code_covers_every_override_without_its_own(master):
    e = run(details={"override_reason_code": "OV-CUST-EXTRA", "override_reason_note": "PO amended"})
    entries.resolve_override(e, JOB, "overproduction_reason")
    entries.resolve_override(e, JOB, entries.QC_GATE_OVERRIDE_KEY)
    assert e.details["overproduction_reason"] == e.details["qc_gate_override_reason"] == "Customer accepts extra — PO amended"
    assert entries.override_requested(e.details, entries.QC_GATE_OVERRIDE_KEY)


def test_other_override_without_note_is_refused(master):
    with pytest.raises(HTTPException) as refused:
        entries.resolve_override(run(details={"qc_gate_override_reason_code": "OV-OTHER"}), JOB, entries.QC_GATE_OVERRIDE_KEY)
    assert refused.value.status_code == 422


def test_qc_gate_override_is_requested_by_code_or_old_text():
    assert entries.override_requested({"qc_gate_override_reason_code": "OV-URGENT"}, entries.QC_GATE_OVERRIDE_KEY)
    assert entries.override_requested({"qc_gate_override_reason": "x"}, entries.QC_GATE_OVERRIDE_KEY)  # an operator still gets 403
    assert not entries.override_requested({"override_reason_code": "OV-URGENT"}, entries.QC_GATE_OVERRIDE_KEY)


# ── Entry corrections (ENTRY_CORRECTION) and close payloads ─────────────


def test_correction_needs_a_code(master):
    payload = entries.Mutation(request_id="void-0001", expected_version=1, reason="typed twice")
    with pytest.raises(HTTPException) as refused:
        entries.correction_reason(payload, JOB, {"sub": "u", "token": "t"}, "voiding this run")
    assert refused.value.status_code == 422 and "voiding this run" in refused.value.detail
    choice = entries.correction_reason(entries.Mutation(request_id="void-0002", reason_code="EC-WRONG-QTY", reason_note="10 not 100"), JOB, {"sub": "u", "token": "t"}, "voiding")
    assert choice.text == "Wrong quantity entered — 10 not 100"


def test_close_payload_takes_short_and_leftover_codes_separately():
    close = entries.CloseInput(request_id="close-0001", short_close=True, reason_code="SS-OTHER", reason_note="paper ran out",
                               residual_disposition="HOLD", residual_reason_code="LI-NEXT-RUN")
    assert (close.reason_code, close.residual_reason_code) == ("SS-OTHER", "LI-NEXT-RUN")
    with pytest.raises(Exception):
        entries.CloseInput(request_id="close-0002", leftover_reason="free text")


# ── Old form: a stage completed below plan (STAGE_SHORT_CLOSE) ──────────


class _Query:
    def __init__(self, first=None):
        self._first = first

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._first


def _short_args(monkeypatch, **extra):
    monkeypatch.setattr(planning, "_all_stage_segments", lambda db, job_id, stage: [])
    db = SimpleNamespace(query=lambda *a, **k: _Query())
    job = SimpleNamespace(id=uuid.uuid4(), plant_id=PLANT, spec_snapshot={"pcs_per_bamboo": 10}, planned_qty=100)
    stage = SimpleNamespace(actuals_snapshot={})
    segment = SimpleNamespace(id=uuid.uuid4())
    args = dict(db=db, job_card=job, stage=stage, segment=segment, selected_stage="WINDER", routing_stages=["WINDER", "OVEN", "PROCESS"],
                output_qty=60, reason_code=None, reason_note=None, current_user={"sub": "pm", "roles": ["PlantManager"], "token": "t"})
    args.update(extra)
    return args


def test_old_form_short_completion_without_a_reason_asks_for_one(monkeypatch, master):
    with pytest.raises(HTTPException) as asked:
        planning._old_form_short_completion(**_short_args(monkeypatch))
    assert asked.value.status_code == 409 and asked.value.detail["code"] == "SHORT_REASON_REQUIRED" and "Choose why" in asked.value.detail["message"]


def test_old_form_short_completion_with_free_text_only_is_refused(monkeypatch, master):
    with pytest.raises(HTTPException) as refused:
        planning._old_form_short_completion(**_short_args(monkeypatch, reason="Paper ran out"))
    assert refused.value.status_code == 422


def test_old_form_short_completion_stores_code_label_note_and_text(monkeypatch, master):
    facts = planning._old_form_short_completion(**_short_args(monkeypatch, reason_code="ss-material-short", reason_note="reel 4 short"))
    assert facts["good"] == 60 and facts["target"] == 100
    assert (facts["reason_code"], facts["reason_label"], facts["reason_note"], facts["reason"]) == ("SS-MATERIAL-SHORT", "Paper or input short", "reel 4 short", "Paper or input short — reel 4 short")
    assert master[-1]["category"] == "STAGE_SHORT_CLOSE" and master[-1]["plant_id"] == PLANT


def test_old_form_short_other_without_note_is_refused(monkeypatch, master):
    with pytest.raises(HTTPException) as refused:
        planning._old_form_short_completion(**_short_args(monkeypatch, reason_code="SS-OTHER"))
    assert refused.value.status_code == 422


def test_old_form_completion_at_plan_needs_no_reason(monkeypatch, master):
    assert planning._old_form_short_completion(**_short_args(monkeypatch, output_qty=100)) is None
    assert not master


# ── Old form: override reason (OVERRIDE) and rejected pieces (SCRAP) ────


def _payload(**kw):
    from src.schemas.planning import StageOutputPayload
    return StageOutputPayload(stage=kw.pop("stage", "PROCESS"), save_mode="complete", output_qty=kw.pop("output_qty", 100), **kw)


USER = {"sub": "owner", "roles": ["Owner"], "token": "t"}


def test_old_form_override_with_free_text_only_is_refused(master):
    with pytest.raises(HTTPException) as refused:
        planning._old_form_override_choice(_payload(override_reason="Customer accepted"), JOB, USER)
    assert refused.value.status_code == 422 and "override" in refused.value.detail


def test_old_form_override_code_gives_label_note_and_text(master):
    choice = planning._old_form_override_choice(_payload(override_reason_code="ov-other", override_reason_note="joint inspection done"), JOB, USER)
    assert (choice.code, choice.label, choice.note, choice.text) == ("OV-OTHER", "Other (write a note)", "joint inspection done", "Other (write a note) — joint inspection done")
    assert master[-1]["category"] == "OVERRIDE" and master[-1]["plant_id"] == PLANT


def test_old_form_other_override_without_note_is_refused(master):
    with pytest.raises(HTTPException):
        planning._old_form_override_choice(_payload(override_reason_code="OV-OTHER"), JOB, USER)


def _reject(stage_name, entry, **kw):
    stage = SimpleNamespace(entry_snapshot=planning._canonicalize_entry_snapshot(stage_name, entry))
    choice = planning._old_form_reject_reason(payload=_payload(stage=stage_name, **kw), stage=stage, selected_stage=stage_name, job_card=JOB, current_user=USER)
    return choice, stage.entry_snapshot


def test_old_form_rejects_without_a_code_are_refused(master):
    for stage_name, entry in (("PROCESS", {"reject_reason": "Crushed ends"}), ("WINDER", {}), ("OVEN", {"reject_bamboo_count": 3})):
        with pytest.raises(HTTPException) as refused:
            _reject(stage_name, entry, scrap_qty=None if stage_name == "OVEN" else 4)
        assert refused.value.status_code == 422 and "rejected" in refused.value.detail


def test_old_form_reject_code_is_stored_with_label_note_and_text(master):
    choice, snap = _reject("WINDER", {"rejection_code": "WL", "reject_reason_note": "loose at the core"}, scrap_qty=2)
    assert (snap["reject_reason_code"], snap["reject_reason_label"], snap["reject_reason_note"], snap["reject_reason"]) == ("WL", "Winding loose", "loose at the core", "Winding loose — loose at the core")
    assert master[-1]["category"] == "SCRAP"


def test_old_form_old_other_code_is_rj_other_and_needs_a_note(master):
    with pytest.raises(HTTPException):
        _reject("PROCESS", {"reject_reason_code": "OT"}, scrap_qty=4)
    _, snap = _reject("PROCESS", {"reject_reason_code": "OT", "reject_reason": "ends crushed in the cart"}, scrap_qty=4)
    assert snap["reject_reason_code"] == "RJ-OTHER" and snap["reject_reason"] == "Other (write a note) — ends crushed in the cart"


def test_old_form_no_rejects_need_no_code(master):
    assert _reject("PROCESS", {}, scrap_qty=0) == (None, {})
    assert not master
