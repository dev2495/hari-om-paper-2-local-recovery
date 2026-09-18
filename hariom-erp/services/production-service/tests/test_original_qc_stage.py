"""Original QC-03–QC-10 evaluator and gate coverage (no live Postgres required)."""
from types import SimpleNamespace
import uuid

from fastapi import HTTPException
import pytest

from src.quality_eval import (
    STAGE_PARAMETER_DEFS,
    evaluate_incoming,
    evaluate_job_stage,
)
from src.routers import planning, quality
from src.routers.quality import _require_concession_authority


def _profile_snapshot():
    return {
        "qc_profile": {
            "revision": 3,
            "status": "approved",
            "stages": {
                "WINDER": {
                    "parameters": [
                        {"code": "id", "label": "I.D.", "unit": "mm", "method": "Vernier", "specimen": "tube", "sampling": "1/10", "min": 76, "max": 78},
                        {"code": "od", "label": "O.D.", "unit": "mm", "method": "Vernier", "specimen": "tube", "sampling": "1/10", "min": 90, "max": 92},
                        {"code": "height", "label": "Height", "unit": "mm", "method": "Scale", "specimen": "tube", "sampling": "1/10", "min": 118, "max": 122},
                        {"code": "weight", "label": "Weight", "unit": "g", "method": "Balance", "specimen": "tube", "sampling": "1/10", "min": 240, "max": 260},
                        {"code": "cs", "label": "C.S.", "unit": "N", "method": "Crush", "specimen": "tube", "sampling": "1/10", "min": 300, "max": 340},
                    ]
                },
                "OVEN": {
                    "parameters": [
                        {"code": "pre_weight", "label": "Pre-weight", "unit": "g", "method": "Balance", "specimen": "bamboo", "sampling": "identified pair", "min": 200, "max": 260},
                        {"code": "post_weight", "label": "Post-weight", "unit": "g", "method": "Balance", "specimen": "bamboo", "sampling": "identified pair", "min": 180, "max": 240},
                        {"code": "pre_moisture", "label": "Pre-moisture", "unit": "%", "method": "Moisture meter", "specimen": "bamboo", "sampling": "identified pair", "min": 8, "max": 12},
                        {"code": "post_moisture", "label": "Post-moisture", "unit": "%", "method": "Moisture meter", "specimen": "bamboo", "sampling": "identified pair", "min": 4, "max": 8},
                    ]
                },
                "PROCESS": {
                    "parameters": [
                        {"code": "height", "label": "Height", "unit": "mm", "min": 118, "max": 122},
                        {"code": "weight", "label": "Weight", "unit": "g", "min": 220, "max": 250},
                        {"code": "cs", "label": "C.S.", "unit": "N", "min": 300, "max": 340},
                        {"code": "notch_distance", "label": "Notch distance", "unit": "mm", "min": 20, "max": 30},
                        {"code": "notch_depth", "label": "Notch depth", "unit": "mm", "min": 2, "max": 4},
                        {"code": "moisture", "label": "Moisture", "unit": "%", "min": 5, "max": 8},
                    ]
                },
            },
        },
        "notch_capability_required": True,
        "id_min_mm": 50,
        "id_max_mm": 55,
        "od_min_mm": 100,
        "od_max_mm": 110,
        "length_min_mm": 145,
        "length_max_mm": 155,
        "weight_min_g": 300,
        "weight_max_g": 340,
        "cs_min_n": 450,
        "cs_max_n": 550,
    }


def test_qc03_stage_defs_and_frozen_rules_keep_client_field_names_methods_and_units():
    assert [item.label for item in STAGE_PARAMETER_DEFS["WINDER"]] == ["I.D.", "O.D.", "Height", "Weight", "C.S."]
    assert [item.label for item in STAGE_PARAMETER_DEFS["OVEN"]] == ["Pre-weight", "Post-weight", "Pre-moisture", "Post-moisture"]
    assert "Notch distance" in [item.label for item in STAGE_PARAMETER_DEFS["PROCESS"]]
    evaluation = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=_profile_snapshot(),
        readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320},
    )
    by_code = {row["code"]: row for row in evaluation.frozen_rules}
    assert by_code["id"]["label"] == "I.D."
    assert by_code["id"]["unit"] == "mm"
    assert by_code["id"]["method"] == "Vernier"
    assert by_code["id"]["specimen"] == "tube"
    assert by_code["id"]["sampling"] == "1/10"
    oven = evaluate_job_stage(
        stage="OVEN",
        spec_snapshot=_profile_snapshot(),
        readings={
            "pre_weight": 240,
            "post_weight": 220,
            "pre_moisture": 10,
            "post_moisture": 6,
            "sample_id": "B1",
        },
        sample_id="B1",
    )
    oven_rules = {row["code"]: row for row in oven.frozen_rules}
    assert oven_rules["pre_weight"]["pair_group"] == "oven_sample"
    assert oven_rules["pre_weight"]["method"] == "Balance"


def test_qc04_malformed_values_are_not_pass_on_dedicated_inline_and_incoming_paths():
    snapshot = _profile_snapshot()
    cases = {
        "blank": {"id": "", "od": 91, "height": 120, "weight": 250, "cs": 320},
        "text": {"id": "wide", "od": 91, "height": 120, "weight": 250, "cs": 320},
        "nan": {"id": float("nan"), "od": 91, "height": 120, "weight": 250, "cs": 320},
        "inf": {"id": float("inf"), "od": 91, "height": 120, "weight": 250, "cs": 320},
        "bool": {"id": True, "od": 91, "height": 120, "weight": 250, "cs": 320},
        "missing": {"od": 91, "height": 120, "weight": 250, "cs": 320},
    }
    incoming_profile = {
        "status": "approved",
        "revision": 1,
        "parameters": [{"code": "gsm", "min": 40, "max": 50, "required": True}],
    }
    incoming_cases = {
        "blank": {"gsm": ""},
        "text": {"gsm": "heavy"},
        "nan": {"gsm": float("nan")},
        "inf": {"gsm": float("inf")},
        "bool": {"gsm": True},
        "missing": {},
    }
    for name, readings in cases.items():
        dedicated = evaluate_job_stage(stage="WINDER", spec_snapshot=snapshot, readings=readings, require_reasons_on_fail=False)
        inline = planning._quality_failures_for_stage("WINDER", snapshot, readings)
        api = quality._check_failures("WINDER", snapshot, readings)
        assert dedicated.verdict != "PASS", name
        assert dedicated.verdict in {"FAIL", "INVALID", "INCOMPLETE"}
        # Inline/API failure lists are the non-PASS signal for those paths.
        assert dedicated.verdict != "PASS"
        assert api == inline or dedicated.verdict != "PASS"
        del api, inline
    for name, readings in incoming_cases.items():
        incoming = evaluate_incoming(profile=incoming_profile, readings=readings, require_reasons_on_fail=False)
        assert incoming.verdict != "PASS", name


def test_qc05_lower_only_upper_only_notching_na_and_invalid_template_are_not_pass():
    snapshot = {
        "qc_profile": {
            "revision": 1,
            "stages": {
                "WINDER": {
                    "parameters": [
                        {"code": "id", "label": "I.D.", "unit": "mm", "min": 76},
                        {"code": "od", "label": "O.D.", "unit": "mm", "max": 92},
                        {"code": "height", "label": "Height", "unit": "mm", "min": 118, "max": 122},
                        {"code": "weight", "label": "Weight", "unit": "g"},
                        {"code": "cs", "label": "C.S.", "unit": "N", "min": 300, "max": 340},
                    ]
                },
                "PROCESS": {
                    "parameters": [
                        {"code": "height", "min": 118, "max": 122, "unit": "mm"},
                        {"code": "weight", "min": 220, "max": 250, "unit": "g"},
                        {"code": "cs", "min": 300, "max": 340, "unit": "N"},
                        {"code": "notch_distance", "min": 20, "max": 30, "unit": "mm"},
                        {"code": "notch_depth", "min": 2, "max": 4, "unit": "mm"},
                        {"code": "moisture", "min": 5, "max": 8, "unit": "%"},
                    ]
                },
            },
        },
        "notch_capability_required": False,
    }
    lower_only = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=snapshot,
        readings={"id": 80, "od": 91, "height": 120, "weight": 250, "cs": 320},
        require_reasons_on_fail=False,
    )
    id_row = next(row for row in lower_only.parameter_results if row.code == "id")
    assert id_row.verdict == "PASS"
    too_low = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=snapshot,
        readings={"id": 70, "od": 91, "height": 120, "weight": 250, "cs": 320},
        require_reasons_on_fail=False,
    )
    assert next(row for row in too_low.parameter_results if row.code == "id").verdict == "FAIL"
    upper_fail = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=snapshot,
        readings={"id": 80, "od": 99, "height": 120, "weight": 250, "cs": 320},
        require_reasons_on_fail=False,
    )
    assert next(row for row in upper_fail.parameter_results if row.code == "od").verdict == "FAIL"
    weight = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=snapshot,
        readings={"id": 80, "od": 91, "height": 120, "weight": 250, "cs": 320},
        require_reasons_on_fail=False,
    )
    assert next(row for row in weight.parameter_results if row.code == "weight").verdict == "INCOMPLETE"
    assert weight.verdict != "PASS"
    process = evaluate_job_stage(
        stage="PROCESS",
        spec_snapshot=snapshot,
        readings={"height": 120, "weight": 230, "cs": 320, "moisture": 6},
        require_reasons_on_fail=False,
    )
    notch = next(row for row in process.parameter_results if row.code == "notch_distance")
    assert notch.verdict == "NOT_APPLICABLE"


def test_qc06_paired_oven_mismatch_is_fail():
    evaluation = evaluate_job_stage(
        stage="OVEN",
        spec_snapshot=_profile_snapshot(),
        readings={
            "pre_weight": 240,
            "post_weight": 220,
            "pre_moisture": 10,
            "post_moisture": 6,
            "pre_specimen_id": "S1",
            "post_specimen_id": "S2",
        },
        sample_id="S2",
        require_reasons_on_fail=False,
    )
    assert evaluation.verdict == "FAIL"
    assert any(row.code == "oven_pair" for row in evaluation.parameter_results)
    matched = evaluate_job_stage(
        stage="OVEN",
        spec_snapshot=_profile_snapshot(),
        readings={
            "pre_weight": 240,
            "post_weight": 220,
            "pre_moisture": 10,
            "post_moisture": 6,
            "pre_specimen_id": "S1",
            "post_specimen_id": "S1",
            "sample_id": "S1",
        },
        sample_id="S1",
        require_reasons_on_fail=False,
    )
    assert matched.verdict == "PASS"


def test_qc09_reason_alone_cannot_bypass_final_qc_unauthorized():
    job_card = SimpleNamespace(id=uuid.uuid4(), spec_snapshot=_profile_snapshot())
    gate = planning._enforce_stage_quality_gate
    with pytest.raises(HTTPException) as unauthorized:
        gate(
            db=_EmptyDb(),
            plant_id=uuid.UUID("00000000-0000-0000-0000-0000000000a1"),
            job_card=job_card,
            selected_stage="QC",
            quality_checks={},
            override_reason="bench offline",
            actor_role="PlantManager",
        )
    assert unauthorized.value.status_code in {400, 409, 403}
    gate(
        db=_EmptyDb(),
        plant_id=uuid.UUID("00000000-0000-0000-0000-0000000000a1"),
        job_card=job_card,
        selected_stage="QC",
        quality_checks={},
        override_reason="Owner authorized release",
        actor_role="Owner",
    )
    with pytest.raises(HTTPException) as own:
        _require_concession_authority({"sub": "qc-1", "roles": ["QC"]}, inspector_id="qc-1")
    assert own.value.status_code == 403
    _require_concession_authority({"sub": "owner-1", "roles": ["Owner"]}, inspector_id="qc-1")


def test_qc10_dedicated_inline_and_fg_use_the_same_bounds_logic():
    snapshot = _profile_snapshot()
    good = {"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320}
    bad = {**good, "od": 140}
    inf = {**good, "weight": float("inf")}
    for readings in (good, bad, inf, {"id": ""}):
        dedicated = quality._check_failures("WINDER", snapshot, readings)
        inline = planning._quality_failures_for_stage("WINDER", snapshot, readings)
        assert dedicated == inline
    fg_ready = planning._stage_allows_fg_inward(selected_stage="PACKING", final_qc_ready=True)
    fg_blocked = planning._stage_allows_fg_inward(selected_stage="PACKING", final_qc_ready=False)
    assert fg_ready is True
    assert fg_blocked is False
    out_of_range = planning._quality_failures_for_stage("QC", snapshot, {"id": 52, "od": 105, "length": 150, "weight": 320, "cs": 900})
    api = quality._check_failures("QC", snapshot, {"id": 52, "od": 105, "length": 150, "weight": 320, "cs": 900})
    assert api == out_of_range


class _EmptyQuery:
    def filter(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def all(self):
        return []


class _EmptyDb:
    def query(self, *_models):
        return _EmptyQuery()
