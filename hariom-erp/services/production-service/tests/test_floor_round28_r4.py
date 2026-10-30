"""Client round 28 Oct, floor round 4: old-form (V1) cards keep the batch-entry rules — at least 2 readings per
required check before Oven or Final QC closes, and rejected Process pieces need a reason."""
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.routers import planning
from src.schemas.planning import StageOutputPayload

OVEN_PROFILE = {
    "qc_profile": {
        "stages": {
            "OVEN": {
                "parameters": [
                    {"code": "pre_weight", "label": "Pre-weight", "applicable": True, "min_readings": 2},
                    {"code": "post_weight", "label": "Post-weight", "applicable": True, "min_readings": 2},
                    {"code": "pre_moisture", "label": "Pre-moisture", "applicable": True, "min_readings": 2},
                    {"code": "post_moisture", "label": "Post-moisture", "applicable": True, "min_readings": 2},
                ]
            }
        }
    }
}
FINAL_SPEC = {"od_min_mm": 81.0, "od_max_mm": 81.4, "id_min_mm": 76.0, "id_max_mm": 76.2}


def _card(spec):
    return SimpleNamespace(id=uuid.uuid4(), spec_snapshot=spec)


@pytest.fixture()
def no_inspections(monkeypatch):
    rows: list = []
    monkeypatch.setattr(planning, "_quality_inspections_for_stage", lambda db, job_card_id, stage, plant_id=None: rows)
    return rows


def _short(spec, stage, checks):
    return planning._old_form_readings_short(db=None, plant_id=uuid.uuid4(), job_card=_card(spec), selected_stage=stage, quality_checks=checks)


def test_old_form_oven_with_one_sample_is_short_and_moisture_is_optional(no_inspections):
    one = {"samples": [{"sample_id": "OV-1", "readings": {"pre_weight": 250, "post_weight": 228, "pre_moisture": 12}}]}
    short = _short(OVEN_PROFILE, "OVEN", one)
    assert [(row["parameter"], row["have"], row["need"]) for row in short] == [("pre_weight", 1, 2), ("post_weight", 1, 2)]
    detail = planning._old_form_readings_short_detail("OVEN", short)
    assert detail["code"] == "STAGE_QC_READINGS_SHORT" and "Oven needs at least 2 readings" in detail["message"]
    assert "Pre-weight 1 of 2" in detail["message"]


def test_old_form_oven_with_two_samples_closes_even_when_a_reading_is_out_of_band(no_inspections):
    two = {"samples": [
        {"sample_id": "OV-1", "readings": {"pre_weight": 250, "post_weight": 228}},
        {"sample_id": "OV-2", "readings": {"pre_weight": 250, "post_weight": 180}},
    ]}
    assert _short(OVEN_PROFILE, "OVEN", two) == []


def test_the_same_sample_id_twice_counts_once_and_earlier_inspections_count(no_inspections):
    same = {"samples": [{"sample_id": "OV-1", "readings": {"pre_weight": 250, "post_weight": 228}}, {"sample_id": "ov-1", "readings": {"pre_weight": 251, "post_weight": 229}}]}
    assert len(_short(OVEN_PROFILE, "OVEN", same)) == 2
    no_inspections.append(SimpleNamespace(id=uuid.uuid4(), sample_id="OV-9", readings={"pre_weight": 249, "post_weight": 227}, evaluation={}))
    no_inspections.append(SimpleNamespace(id=uuid.uuid4(), sample_id="OV-8", readings={"pre_weight": 249, "post_weight": 227}, evaluation={"workflow_status": "SUPERSEDED"}))
    assert _short(OVEN_PROFILE, "OVEN", same) == []


def test_old_form_final_qc_needs_two_samples_of_every_spec_reading(no_inspections):
    good = {"od": 81.2, "id": 76.1}
    one = {**good, "sample_id": "FQ1", "samples": [{"sample_id": "FQ1", "readings": good}]}
    assert {row["parameter"] for row in _short(FINAL_SPEC, "QC", one)} == {"id", "od"}
    two = {**good, "samples": [{"sample_id": "FQ1", "readings": good}, {"sample_id": "FQ2", "readings": {**good, "od": 90.0}}]}
    assert _short(FINAL_SPEC, "QC", two) == []
    assert "Final QC needs" in planning._old_form_readings_short_detail("QC", _short(FINAL_SPEC, "QC", {}))["message"]


def test_cards_without_required_checks_and_other_stages_are_not_checked(no_inspections):
    assert _short({}, "OVEN", {}) == []
    assert _short({"pcs_per_bamboo": 10}, "QC", {}) == []
    assert _short(OVEN_PROFILE, "PROCESS", {}) == []


def test_old_form_process_rejects_need_a_reason():
    stage = SimpleNamespace(entry_snapshot={}, actuals_snapshot={})
    payload = StageOutputPayload(stage="PROCESS", save_mode="complete", output_qty=110, scrap_qty=6, entry_snapshot={"reject_qty": "6", "reject_reason": " "})
    with pytest.raises(HTTPException) as refused:
        planning._validate_stage_completion_payload(selected_stage="PROCESS", payload=payload, stage=stage)
    assert refused.value.status_code == 422 and "Reject reason is required" in refused.value.detail and "6 pcs" in refused.value.detail
    with_reason = StageOutputPayload(stage="PROCESS", save_mode="complete", output_qty=110, scrap_qty=6, entry_snapshot={"reject_qty": "6", "reject_reason": "Crushed ends"})
    planning._validate_stage_completion_payload(selected_stage="PROCESS", payload=with_reason, stage=stage)
    no_rejects = StageOutputPayload(stage="PROCESS", save_mode="complete", output_qty=116, scrap_qty=0, entry_snapshot={"reject_reason": ""})
    planning._validate_stage_completion_payload(selected_stage="PROCESS", payload=no_rejects, stage=stage)


class _NoRows:
    def query(self, *args):
        return self

    def join(self, *args):
        return self

    def filter(self, *args):
        return self

    def all(self):
        return []


def test_capacity_warning_says_past_the_tolerance_when_the_override_carried_the_save(monkeypatch):
    monkeypatch.setattr(planning, "_oven_bamboo_capacity_profile", lambda stage, machine: (100.0, "PCS_PER_SHIFT"))
    monkeypatch.setattr(planning, "_execution_load_for_capacity", lambda capacity_unit, output_qty, spec_snapshot: output_qty)
    row = SimpleNamespace(machine_id=uuid.uuid4(), shift_code="SHIFT_A", job_card=SimpleNamespace(plant_id=uuid.uuid4(), spec_snapshot={}))

    def warn(qty, override=None):
        out: list = []
        planning._validate_execution_capacity(db=_NoRows(), stage_row=row, stage="PROCESS", machine={}, output_qty=qty, entry_snapshot={}, override_reason=override, warnings=out)
        return out

    assert warn(105) == ["Process shift output is 5.0% over capacity — inside the +10% tolerance."]
    past = warn(140.6, override="Two shifts ran on this line")
    assert past == ["Process shift output is 40.6% over capacity — past the +10% tolerance, saved with the override reason."]
    with pytest.raises(HTTPException) as refused:
        warn(140.6)
    assert refused.value.status_code == 409


WINDER_PROCESS_PROFILE = {
    "qc_profile": {
        "stages": {
            "WINDER": {"parameters": [
                {"code": "id", "label": "I.D.", "applicable": True, "min_readings": 2},
                {"code": "od", "label": "O.D.", "applicable": True, "min_readings": 2},
            ]},
            "PROCESS": {"parameters": [
                {"code": "id", "label": "I.D.", "applicable": True, "min_readings": 2},
                {"code": "od", "label": "O.D.", "applicable": True, "min_readings": 2},
                {"code": "moisture", "label": "Moisture", "applicable": True, "min_readings": 2},
                {"code": "notch_depth", "label": "Notch depth", "applicable": False, "min_readings": 2},
            ]},
        }
    }
}


def test_old_form_winder_and_process_need_two_readings_per_check(no_inspections):
    one_w = {"samples": [{"sample_id": "W1", "readings": {"id": 76.3, "od": 82.0}}]}
    assert [(row["parameter"], row["have"]) for row in _short(WINDER_PROCESS_PROFILE, "WINDER", one_w)] == [("id", 1), ("od", 1)]
    assert "Winder needs at least 2 readings" in planning._old_form_readings_short_detail("WINDER", _short(WINDER_PROCESS_PROFILE, "WINDER", one_w))["message"]
    two_w = {"samples": [{"sample_id": "W1", "readings": {"id": 76.3, "od": 82.0}}, {"sample_id": "W2", "readings": {"id": 76.3, "od": 99.0}}]}
    assert _short(WINDER_PROCESS_PROFILE, "WINDER", two_w) == []
    # Process keeps I.D./O.D.; moisture is optional and a check the card does not carry is left out.
    one_p = {"samples": [{"sample_id": "P1", "readings": {"id": 76.3, "od": 82.0}}]}
    assert {row["parameter"] for row in _short(WINDER_PROCESS_PROFILE, "PROCESS", one_p)} == {"id", "od"}
    two_p = {"samples": [{"sample_id": "P1", "readings": {"id": 76.3, "od": 82.0}}, {"sample_id": "P1-2", "readings": {"id": 76.2, "od": 82.1}}]}
    assert _short(WINDER_PROCESS_PROFILE, "PROCESS", two_p) == []


def test_old_form_stage_qc_out_of_band_is_flagged_and_the_new_hold_is_dropped(monkeypatch):
    stage_key = "WINDER"
    earlier_hold = SimpleNamespace(id=uuid.uuid4(), stage_type="WINDER")
    new_hold = SimpleNamespace(id=uuid.uuid4(), stage_type="WINDER")
    fail = SimpleNamespace(id=uuid.uuid4(), status="FAIL", sample_id="W1", evaluation={}, failures=[{"parameter": "od", "label": "O.D."}])
    monkeypatch.setattr(planning, "_quality_inspections_for_stage", lambda db, job_card_id, stage, plant_id=None: [fail])
    deleted: list = []
    db = SimpleNamespace(delete=deleted.append, flush=lambda: None)
    kept, flagged = planning._flag_not_hold_old_form_qc(
        db=db, job_card=_card({}), plant_id=uuid.uuid4(), selected_stage=stage_key,
        quality_holds=[earlier_hold, new_hold], earlier_inspection_ids=set(), earlier_hold_ids={earlier_hold.id},
    )
    assert kept == [earlier_hold] and deleted == [new_hold]
    assert fail.evaluation["flagged_not_held"] is True and flagged[0]["parameter"] == "od"
    stage = SimpleNamespace(actuals_snapshot={})
    from datetime import datetime
    words = planning._set_old_form_qc_flag(stage=stage, selected_stage="WINDER", flags=flagged, now=datetime(2026, 10, 30))
    assert words == ["Winder QC out of band: O.D. Saved and flagged, not held."]
    assert stage.actuals_snapshot["qc_flag"]["stage"] == "WINDER"
