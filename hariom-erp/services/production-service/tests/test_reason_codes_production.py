"""Reasons are Masters › Reason codes only (owner decision 4, 1 Nov 2026) in production's QC holds,
operations (short close, downtime) and month-end (variance notes, re-open).

Free text alone is refused, a valid code is stored with its label at the time, its note and the old
"Label — note" text, an OTHER code needs a note, a downtime edit is checked like a new entry and a hold
release without a body is refused. Master data is replaced by the real helper's rules (no HTTP) or by a
stub returning a fixed label.
"""
import uuid
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from src.models import MachineDowntime, QualityHold
from src.reasons import ReasonChoice
from src.routers import operations as ops
from src.routers import quality
from src.routers import reconciliation as reco

PLANT = uuid.uuid4()
ADMIN = {"sub": "admin-1", "roles": ["Admin"], "token": "t"}
LABELS = {
    "QH-SUSPECT": "Suspected quality problem",
    "QR-RETEST-OK": "Retest passed",
    "DT-POWER": "Power cut",
    "DT-BREAKDOWN": "Machine breakdown",
    "SH-MATERIAL": "Material short",
}


def stub_master(calls=None):
    """The shared helper's answer for a known code; any other code is refused like the master does."""
    def resolve(*, category, code, note=None, plant_id=None, token=None, required=True, what="this"):
        if calls is not None:
            calls.append({"category": category, "code": code, "note": note, "plant_id": plant_id, "token": token})
        wanted = str(code or "").strip().upper()
        if not wanted:
            raise HTTPException(status_code=422, detail=f"Choose a reason for {what} from the list (Masters › Reason codes).")
        if wanted not in LABELS:
            raise HTTPException(status_code=422, detail=f"{wanted} is not a valid reason here.")
        return ReasonChoice(category, wanted, LABELS[wanted], (note or "").strip() or None)
    return resolve


def _stamp(obj):
    if getattr(obj, "id", None) is None:
        obj.id = uuid.uuid4()
    if getattr(obj, "created_at", None) is None:
        obj.created_at = datetime(2026, 11, 1, 9, 0)


# ── QC hold ──────────────────────────────────────────────────────────────


def _hold_db(job):
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = job
    db.refresh.side_effect = _stamp
    added = []
    db.add.side_effect = added.append
    db.flush.side_effect = lambda: [_stamp(item) for item in added if isinstance(item, QualityHold)]
    return db, added


def _job():
    return SimpleNamespace(id=uuid.uuid4(), plant_id=PLANT, spec_snapshot={})


def test_manual_hold_with_free_text_only_is_refused():
    db, added = _hold_db(_job())
    payload = quality.HoldCreate(job_card_id=uuid.uuid4(), stage_type="WINDER", reason="Bent tubes on the cart")
    with pytest.raises(HTTPException) as refused:
        quality.create_hold(payload, db=db, plant_id=str(PLANT), current_user=ADMIN)
    assert refused.value.status_code == 422 and "Choose a reason for the QC hold" in refused.value.detail
    assert not [item for item in added if isinstance(item, QualityHold)]
    db.commit.assert_not_called()


def test_manual_hold_other_without_a_note_is_refused():
    db, _ = _hold_db(_job())
    payload = quality.HoldCreate(job_card_id=uuid.uuid4(), stage_type="WINDER", reason_code="QH-OTHER", reason_note="bad")
    with pytest.raises(HTTPException) as refused:
        quality.create_hold(payload, db=db, plant_id=str(PLANT), current_user=ADMIN)
    assert refused.value.status_code == 422 and "at least 5" in refused.value.detail


def test_manual_hold_stores_code_label_note_and_legacy_text(monkeypatch):
    calls = []
    monkeypatch.setattr(quality, "resolve_reason", stub_master(calls))
    job = _job()
    db, added = _hold_db(job)
    payload = quality.HoldCreate(job_card_id=job.id, stage_type="OVEN", reason_code="qh-suspect", reason_note="edge damage")
    response = quality.create_hold(payload, db=db, plant_id=str(PLANT), current_user=ADMIN)
    hold = next(item for item in added if isinstance(item, QualityHold))
    assert (hold.reason_code, hold.reason_label, hold.reason_note) == ("QH-SUSPECT", "Suspected quality problem", "edge damage")
    assert hold.reason == "Suspected quality problem — edge damage"
    assert calls[0]["category"] == "QC_HOLD" and calls[0]["plant_id"] == PLANT and calls[0]["token"] == "t"
    assert response.reason_label == "Suspected quality problem" and response.reason == hold.reason


def _release_db(hold):
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = hold
    db.query.return_value.filter.return_value.count.return_value = 1  # another hold stays on the card
    db.get.return_value = SimpleNamespace(spec_snapshot={})
    return db


def _held():
    return QualityHold(id=uuid.uuid4(), plant_id=PLANT, job_card_id=uuid.uuid4(), stage_type="WINDER",
                       reason="Old typed reason", status="HOLD", created_at=datetime(2026, 10, 30))


def test_release_without_a_body_is_refused():
    hold = _held()
    db = _release_db(hold)
    with pytest.raises(HTTPException) as refused:
        quality.release_hold(hold.id, None, db=db, plant_id=str(PLANT), current_user=ADMIN)
    assert refused.value.status_code == 422 and "hold release" in refused.value.detail
    assert hold.status == "HOLD"
    db.commit.assert_not_called()


def test_release_with_free_text_only_is_refused():
    hold = _held()
    db = _release_db(hold)
    with pytest.raises(HTTPException) as refused:
        quality.release_hold(hold.id, quality.HoldReleasePayload(reason="Checked again, fine"), db=db, plant_id=str(PLANT), current_user=ADMIN)
    assert refused.value.status_code == 422
    assert hold.status == "HOLD"


def test_release_stores_code_label_note_and_disposition(monkeypatch):
    monkeypatch.setattr(quality, "resolve_reason", stub_master())
    hold = _held()
    db = _release_db(hold)
    body = quality.HoldReleasePayload(reason_code="QR-RETEST-OK", reason_note="2 readings in band", disposition="SORTED", affected_qty=40)
    response = quality.release_hold(hold.id, body, db=db, plant_id=str(PLANT), current_user=ADMIN)
    assert hold.status == "RELEASED"
    assert (hold.release_reason_code, hold.release_reason_label, hold.release_reason_note, hold.release_disposition) == (
        "QR-RETEST-OK", "Retest passed", "2 readings in band", "SORTED")
    assert hold.reason == "Old typed reason"  # the hold's own reason is untouched
    audit = next(call.args[0] for call in db.add.call_args_list if type(call.args[0]).__name__ == "AuditEvent")
    assert audit.payload["reason"] == "Retest passed — 2 readings in band" and audit.payload["disposition"] == "SORTED"
    assert response.release_reason_label == "Retest passed"


# ── Operations: shared validator, short close, downtime ─────────────────


def test_validate_reason_code_delegates_to_the_master_helper(monkeypatch):
    calls = []
    monkeypatch.setattr(ops, "resolve_reason", stub_master(calls))
    choice = ops._validate_reason_code(token="t", plant_id=PLANT, code="sh-material", category="SHORT_CLOSE", note="reel late")
    assert (choice.code, choice.label, choice.note) == ("SH-MATERIAL", "Material short", "reel late")
    assert calls == [{"category": "SHORT_CLOSE", "code": "sh-material", "note": "reel late", "plant_id": PLANT, "token": "t"}]


def test_short_close_other_without_a_note_is_refused_before_the_master():
    with pytest.raises(HTTPException) as refused:
        ops._validate_reason_code(token="t", plant_id=PLANT, code="SH-OTHER", category="SHORT_CLOSE")
    assert refused.value.status_code == 422 and "at least 5" in refused.value.detail


def test_short_close_without_a_code_is_refused():
    payload = ops.ShortClosePayload(produced_qty=10, reason_code="", decision="HOLD", notes="material short")
    with pytest.raises(HTTPException) as refused:
        ops.short_close_job_card(uuid.uuid4(), payload, db=Mock(), plant_scope={"selected_plant_id": str(PLANT)}, current_user=ADMIN)
    assert refused.value.status_code == 422 and "Choose a reason" in refused.value.detail


def test_short_close_payload_keeps_accepting_what_the_shortage_panel_sends():
    # JobCardShortagePanel (V2 card) still sends reason_code + decision + notes (+ stage, qty).
    payload = ops.ShortClosePayload(produced_qty=10, reason_code="SH-MATERIAL", decision="HOLD", stage_type="QC", notes="reel late")
    assert payload.reason_note is None and payload.notes == "reel late"


def _downtime_db():
    db = Mock()
    db.refresh.side_effect = _stamp
    return db


def test_downtime_with_free_text_only_is_refused(monkeypatch):
    payload = ops.DowntimeCreate(machine_id=uuid.uuid4(), started_at=datetime(2026, 11, 1, 6, 0), reason_code="", notes="power went")
    with pytest.raises(HTTPException) as refused:
        ops.create_downtime(payload, db=_downtime_db(), plant_scope={"selected_plant_id": str(PLANT)}, current_user=ADMIN)
    assert refused.value.status_code == 422


def test_downtime_create_stores_label_and_note(monkeypatch):
    calls = []
    monkeypatch.setattr(ops, "resolve_reason", stub_master(calls))
    monkeypatch.setattr(ops, "record_audit_event", lambda **kw: None)
    db = _downtime_db()
    payload = ops.DowntimeCreate(machine_id=uuid.uuid4(), started_at=datetime(2026, 11, 1, 6, 0), ended_at=datetime(2026, 11, 1, 6, 30),
                                 reason_code="dt-power", reason_note="MSEB feeder trip")
    response = ops.create_downtime(payload, db=db, plant_scope={"selected_plant_id": str(PLANT)}, current_user=ADMIN)
    row = db.add.call_args.args[0]
    assert (row.reason_code, row.reason_label, row.reason_note) == ("DT-POWER", "Power cut", "MSEB feeder trip")
    assert calls[0]["category"] == "DOWNTIME" and calls[0]["plant_id"] == PLANT
    assert response.reason_label == "Power cut" and response.duration_minutes == 30


def _downtime_row():
    return MachineDowntime(id=uuid.uuid4(), plant_id=PLANT, machine_id=uuid.uuid4(), started_at=datetime(2026, 11, 1, 6, 0),
                           reason_code="DT-POWER", reason_label="Power cut", is_planned=False, affected_job_card_ids=[],
                           created_at=datetime(2026, 11, 1, 6, 0))


def _edit_db(row):
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = row
    return db


def test_downtime_edit_with_a_bad_code_is_refused(monkeypatch):
    monkeypatch.setattr(ops, "resolve_reason", stub_master())
    monkeypatch.setattr(ops, "_apply_plant_scope", lambda query, *args, **kwargs: query)
    row = _downtime_row()
    db = _edit_db(row)
    with pytest.raises(HTTPException) as refused:
        ops.update_downtime(row.id, ops.DowntimeUpdate(reason_code="ANYTHING"), db=db, plant_scope={"selected_plant_id": str(PLANT)}, current_user=ADMIN)
    assert refused.value.status_code == 422
    assert row.reason_code == "DT-POWER"
    db.commit.assert_not_called()


def test_downtime_edit_with_a_new_code_stores_its_label(monkeypatch):
    calls = []
    monkeypatch.setattr(ops, "resolve_reason", stub_master(calls))
    monkeypatch.setattr(ops, "_apply_plant_scope", lambda query, *args, **kwargs: query)
    monkeypatch.setattr(ops, "record_audit_event", lambda **kw: None)
    row = _downtime_row()
    response = ops.update_downtime(row.id, ops.DowntimeUpdate(reason_code="dt-breakdown", reason_note="bearing gone"),
                                   db=_edit_db(row), plant_scope={"selected_plant_id": str(PLANT)}, current_user=ADMIN)
    assert (row.reason_code, row.reason_label, row.reason_note) == ("DT-BREAKDOWN", "Machine breakdown", "bearing gone")
    assert calls[0]["plant_id"] == PLANT  # the row's own plant
    assert response.reason_label == "Machine breakdown"


def test_downtime_edit_closing_an_event_does_not_call_the_master(monkeypatch):
    calls = []
    monkeypatch.setattr(ops, "resolve_reason", stub_master(calls))
    monkeypatch.setattr(ops, "_apply_plant_scope", lambda query, *args, **kwargs: query)
    monkeypatch.setattr(ops, "record_audit_event", lambda **kw: None)
    row = _downtime_row()
    ops.update_downtime(row.id, ops.DowntimeUpdate(reason_code="DT-POWER", ended_at=datetime(2026, 11, 1, 7, 0)),
                        db=_edit_db(row), plant_scope={"selected_plant_id": str(PLANT)}, current_user=ADMIN)
    assert calls == [] and row.duration_minutes == 60 and row.reason_label == "Power cut"


# ── Month end ────────────────────────────────────────────────────────────


OWNER = {"sub": "owner-1", "roles": ["Owner"], "role": "Owner", "token": "t"}
PM = {"sub": "pm-1", "roles": ["PlantManager"], "token": "t"}


def test_month_end_note_with_free_text_only_is_refused(monkeypatch):
    monkeypatch.setattr(reco, "_closed_month_set", lambda db, plant: set())
    monkeypatch.setattr(reco, "_consumption_ist_today", lambda: date(2026, 11, 5))
    monkeypatch.setattr(reco, "_fetch_month_figures", lambda token, plant, month: {"month_end_count": {"status": "APPROVED"}, "items": []})
    db = Mock()
    payload = reco.MonthEndNotePayload(month="2026-10", item_code="KRAFT-1", note="Trial run on winder 2")
    with pytest.raises(HTTPException) as refused:
        reco.put_month_end_note(payload, db, {"selected_plant_id": str(PLANT), "scope_all": False}, PM)
    assert refused.value.status_code == 422 and "variance" in refused.value.detail
    db.commit.assert_not_called()


def test_month_end_reopen_with_free_text_only_is_refused():
    payload = reco.MonthEndReopenPayload(month="2026-09", reason="Late GRN for kraft")
    with pytest.raises(HTTPException) as refused:
        reco.post_month_end_reopen(payload, Mock(), {"selected_plant_id": str(PLANT), "scope_all": False}, OWNER)
    assert refused.value.status_code == 422 and "re-opening the month" in refused.value.detail


def test_month_note_view_shows_old_notes_as_they_were():
    old = SimpleNamespace(note="Typed before codes", noted_by="pm", noted_at=None)
    assert reco._month_note_view(old) == {"note": "Typed before codes", "reason_code": None, "reason_label": None,
                                          "reason_note": None, "noted_by": "pm", "noted_at": None}


def test_v1_shortage_gap_leaves_out_pcs_a_stage_already_gave_back(monkeypatch):
    """Verifier 2026-11-01: an old-form card whose Winding was completed below plan already returned 520 of 1000
    pcs to the order; final QC accepts 470, so the commercial gap is 10, not 530 (no double count in Sales)."""
    job = SimpleNamespace(id=uuid.uuid4(), plant_id=PLANT, status="IN_PROGRESS", planned_qty=1000.0, released_qty=480.0, returned_qty=520.0,
                          sales_order_line_id=uuid.uuid4(), spec_snapshot={"entry_model": "V1"}, routing_snapshot={}, requires_slitting=False)

    class Q:
        def __init__(self, row): self.row = row
        def filter(self, *a, **k): return self
        def filter_by(self, *a, **k): return self
        def first(self): return self.row
        def count(self): return 1

    db = Mock()
    db.query.side_effect = lambda model, *a: Q(job if model is ops.JobCard else None)
    monkeypatch.setattr(ops, "_validate_reason_code", lambda **kw: SimpleNamespace(code="SH-MATERIAL", label="Material short", note=None))
    seen = {}
    monkeypatch.setattr(ops, "_sync_sales_short_close", lambda **kw: seen.update(kw))
    payload = ops.ShortClosePayload(decision="SHORT_CLOSE_SO", reason_code="SH-MATERIAL", stage_type="JOB_CARD", produced_qty=470)
    try:
        ops._short_close_job_card(job.id, payload, db=db, plant_scope={"scope_all": True}, current_user=ADMIN)
    except Exception:
        pass  # the response needs a real row; only the Sales call matters here
    assert seen["gap_qty"] == 10 and seen["produced_qty"] == 470


def test_all_plants_scope_cannot_short_close_or_change_downtime():
    # All plants is the Owner/Admin read-only view (3 Nov 2026): every write names one plant.
    payload = ops.ShortClosePayload(produced_qty=10, reason_code="SH-MATERIAL", decision="HOLD", notes="x")
    for call in (lambda: ops.short_close_job_card(uuid.uuid4(), payload, db=Mock(), plant_scope={"scope_all": True, "allowed_plants": [str(PLANT)]}, current_user=ADMIN),
                 lambda: ops.update_downtime(uuid.uuid4(), ops.DowntimeUpdate(reason_code="DT-POWER"), db=Mock(), plant_scope={"scope_all": True}, current_user=ADMIN)):
        with pytest.raises(HTTPException) as refused:
            call()
        assert refused.value.status_code == 400 and "view only" in refused.value.detail
