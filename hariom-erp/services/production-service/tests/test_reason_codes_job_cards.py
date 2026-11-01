"""Job card force close / cancel, split, edit, emergency insert and surplus kept take a master reason code
(owner decision 4, 1 Nov 2026): free text alone is refused, an OTHER code needs a note, a code of another
list is refused, and a valid code gives code, label at the time, note and the old "Label — note" text.

Master data is the conftest stand-in (any code, label = code in words) or a stub that knows which list
each code belongs to. The endpoint flows themselves run in test_job_card_entry_flows_postgres.py and
test_dispatch_surplus_postgres.py.
"""
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.reasons import ReasonChoice
from src.routers import dispatch_surplus as ds
from src.routers import lifecycle
from src.short_close import apply_short_close

PLANNER = {"sub": "planner-1", "roles": ["Planner"], "token": "t"}
JOB = SimpleNamespace(id=uuid.uuid4(), plant_id=uuid.uuid4())
LISTS = {"JC-": "JOB_CARD_CLOSE", "CH-": "JOB_CARD_CHANGE", "SR-": "SURPLUS_RETAIN"}


def by_list(calls):
    """The master's answer: a code is valid only in its own list (category)."""
    def resolve(*, category, code, note=None, plant_id=None, token=None, required=True, what="this"):
        calls.append({"category": category, "code": code, "note": note, "plant_id": plant_id, "token": token})
        wanted = str(code or "").upper()
        if not wanted:
            raise HTTPException(422, f"Choose a reason for {what} from the list (Masters › Reason codes).")
        if LISTS.get(wanted[:3]) != category:
            raise HTTPException(422, f"{wanted} is not in the {category} list.")
        return ReasonChoice(category, wanted, f"Label of {wanted}", (note or "").strip() or None)
    return resolve


PAYLOADS = [
    ("JOB_CARD_CLOSE", "closing the job card", lambda **kw: lifecycle.ForceClosePayload(**kw)),
    ("JOB_CARD_CHANGE", "splitting the job card", lambda **kw: lifecycle.SplitPayload(qty=10, **kw)),
    ("JOB_CARD_CHANGE", "editing the job card", lambda **kw: lifecycle.AmendPayload(planned_qty=10, **kw)),
    ("JOB_CARD_CHANGE", "the emergency insert", lambda **kw: lifecycle.EmergencyPayload(job_card_id=uuid.uuid4(), machine_id=uuid.uuid4(),
                                                                                         plan_date="2026-11-02", shift_code="SHIFT_A", **kw)),
]


@pytest.mark.parametrize("category,what,make", PAYLOADS)
def test_free_text_alone_is_refused(category, what, make):
    with pytest.raises(HTTPException) as refused:
        lifecycle._reason(make(reason="Customer cut the order"), JOB, PLANNER, category=category, what=what)
    assert refused.value.status_code == 422 and f"Choose a reason for {what}" in refused.value.detail


@pytest.mark.parametrize("category,what,make", PAYLOADS)
def test_other_code_needs_a_note(category, what, make):
    with pytest.raises(HTTPException) as refused:
        lifecycle._reason(make(reason_code="JC-OTHER", reason_note="abc"), JOB, PLANNER, category=category, what=what)
    assert refused.value.status_code == 422 and "at least 5 characters" in refused.value.detail


def test_code_of_another_list_is_refused(monkeypatch):
    calls = []
    monkeypatch.setattr(lifecycle, "resolve_reason", by_list(calls))
    with pytest.raises(HTTPException) as refused:
        lifecycle._reason(lifecycle.ForceClosePayload(reason_code="CH-URGENT"), JOB, PLANNER, category="JOB_CARD_CLOSE", what="closing the job card")
    assert refused.value.status_code == 422 and "not in the JOB_CARD_CLOSE list" in refused.value.detail
    assert calls[0]["plant_id"] == JOB.plant_id and calls[0]["token"] == "t"  # checked against the card's plant
    with pytest.raises(HTTPException):
        lifecycle._reason(lifecycle.SplitPayload(qty=5, reason_code="JC-MERGED"), JOB, PLANNER, category="JOB_CARD_CHANGE", what="splitting the job card")


def test_valid_code_gives_code_label_note_and_old_text(monkeypatch):
    monkeypatch.setattr(lifecycle, "resolve_reason", by_list([]))
    choice = lifecycle._reason(lifecycle.ForceClosePayload(reason_code="jc-material-short", reason_note=" no kraft "), JOB, PLANNER,
                               category="JOB_CARD_CLOSE", what="closing the job card")
    assert lifecycle._reason_audit(choice) == {"reason": "Label of JC-MATERIAL-SHORT — no kraft", "reason_code": "JC-MATERIAL-SHORT",
                                               "reason_label": "Label of JC-MATERIAL-SHORT", "reason_note": "no kraft"}


def test_surplus_kept_needs_a_surplus_code(monkeypatch):
    body = dict(request_id="keep-1", expected_remaining_qty=5)
    with pytest.raises(HTTPException) as free_text:
        ds._surplus_reason(ds.RetainSurplusInput(**body, reason="Kept for the next order"), JOB, PLANNER)
    assert free_text.value.status_code == 422
    with pytest.raises(HTTPException) as other:
        ds._surplus_reason(ds.RetainSurplusInput(**body, reason_code="SR-OTHER"), JOB, PLANNER)
    assert other.value.status_code == 422
    monkeypatch.setattr(ds, "resolve_reason", by_list([]))
    with pytest.raises(HTTPException) as wrong:
        ds._surplus_reason(ds.RetainSurplusInput(**body, reason_code="JC-OTHER", reason_note="whatever it is"), JOB, PLANNER)
    assert wrong.value.status_code == 422
    choice = ds._surplus_reason(ds.RetainSurplusInput(**body, reason_code="SR-NEXT-ORDER", reason_note="Part box"), JOB, PLANNER)
    assert ds._reason_fields(choice) == {"reason": "Label of SR-NEXT-ORDER — Part box", "reason_code": "SR-NEXT-ORDER",
                                         "reason_label": "Label of SR-NEXT-ORDER", "reason_note": "Part box"}


def test_conftest_master_stand_in_resolves_through_the_real_helper():
    choice = lifecycle._reason(lifecycle.EmergencyPayload(job_card_id=uuid.uuid4(), machine_id=uuid.uuid4(), plan_date="2026-11-02",
                                                          shift_code="SHIFT_A", reason_code="CH-URGENT"), JOB, PLANNER,
                               category="JOB_CARD_CHANGE", what="the emergency insert")
    assert (choice.code, choice.label, choice.text) == ("CH-URGENT", "Ch urgent", "Ch urgent")
    with pytest.raises(HTTPException) as unknown:
        lifecycle._reason(lifecycle.ForceClosePayload(reason_code="BAD-CODE"), JOB, PLANNER, category="JOB_CARD_CLOSE", what="closing")
    assert unknown.value.status_code == 422


def test_short_close_record_and_sales_return_carry_the_code_and_label():
    """apply_short_close (stage short close) keeps the checked code/label/note and sends them to Sales."""
    added = []

    class Db:
        def query(self, *_):
            return self

        def filter_by(self, **_):
            return self

        def first(self):
            return None

        def add(self, row):
            added.append(row)

    job = SimpleNamespace(id=uuid.uuid4(), plant_id=uuid.uuid4(), release_lot_id=uuid.uuid4(), planned_qty=100, released_qty=100,
                          returned_qty=0, spec_snapshot={}, material_plan_snapshot={})
    row = SimpleNamespace(stage_type="PROCESS", actuals_snapshot={"effective_target_pcs": 100, "effective_target": 100})
    record = apply_short_close(Db(), job, "PROCESS", row, good=60, target=100, routing=["WINDER", "OVEN", "PROCESS"], ppb=None,
                               reason="Machine breakdown — motor", user={"sub": "u"}, reason_code="SS-MACHINE",
                               reason_label="Machine breakdown", reason_note="motor")
    assert (record["reason_code"], record["reason_label"], record["reason_note"], record["reason"]) == ("SS-MACHINE", "Machine breakdown", "motor", "Machine breakdown — motor")
    effect = next(item for item in added if getattr(item, "kind", None) == "sales_return")
    assert effect.payload["reason_code"] == "SS-MACHINE" and effect.payload["reason_label"] == "Machine breakdown" and effect.payload["qty"] == record["returned_pcs"]
