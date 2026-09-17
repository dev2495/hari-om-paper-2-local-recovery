from src.quality_eval import (
    evaluate_incoming,
    evaluate_job_stage,
    submission_error,
)


def _winder_snapshot():
    return {
        "id_min_mm": 50,
        "id_max_mm": 55,
        "length_min_mm": 145,
        "length_max_mm": 155,
        "qc_profile": {
            "revision": 3,
            "stages": {
                "WINDER": {
                    "parameters": [
                        {"code": "id", "label": "I.D.", "unit": "mm", "min": 76, "max": 78},
                        {"code": "od", "label": "O.D.", "unit": "mm", "min": 90, "max": 92},
                        {"code": "height", "label": "Height", "unit": "mm", "min": 118, "max": 122},
                        {"code": "weight", "label": "Weight", "unit": "g", "min": 240, "max": 260},
                        {"code": "cs", "label": "C.S.", "unit": "N", "min": 300, "max": 340},
                    ]
                },
                "OVEN": {
                    "parameters": [
                        {"code": "pre_weight", "label": "Pre-weight", "unit": "g", "min": 200, "max": 260},
                        {"code": "post_weight", "label": "Post-weight", "unit": "g", "min": 180, "max": 240},
                        {"code": "pre_moisture", "label": "Pre-moisture", "unit": "%", "min": 8, "max": 12},
                        {"code": "post_moisture", "label": "Post-moisture", "unit": "%", "min": 4, "max": 8},
                    ]
                },
                "PROCESS": {
                    "parameters": [
                        {"code": "height", "label": "Height", "unit": "mm", "min": 118, "max": 122},
                        {"code": "weight", "label": "Weight", "unit": "g", "min": 220, "max": 250},
                        {"code": "cs", "label": "C.S.", "unit": "N", "min": 300, "max": 340},
                        {"code": "notch_distance", "label": "Notch distance", "unit": "mm", "min": 20, "max": 30, "applicable": True},
                        {"code": "notch_depth", "label": "Notch depth", "unit": "mm", "min": 2, "max": 4, "applicable": True},
                        {"code": "moisture", "label": "Moisture", "unit": "%", "min": 5, "max": 8},
                    ]
                },
            },
        },
        "notch_capability_required": True,
    }


def test_winder_in_range_is_pass():
    evaluation = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=_winder_snapshot(),
        readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320},
    )
    assert evaluation.verdict == "PASS"
    assert all(row.verdict == "PASS" for row in evaluation.parameter_results)


def test_winder_out_of_range_fail_requires_reason():
    evaluation = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=_winder_snapshot(),
        readings={"id": 77, "od": 91, "height": 150, "weight": 250, "cs": 320},
        reasons={},
        require_reasons_on_fail=True,
    )
    assert evaluation.verdict == "FAIL"
    assert "height" in evaluation.missing_reasons
    assert submission_error(evaluation)
    with_reason = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=_winder_snapshot(),
        readings={"id": 77, "od": 91, "height": 150, "weight": 250, "cs": 320},
        reasons={"height": "bamboo crushed at trim"},
        require_reasons_on_fail=True,
    )
    assert with_reason.verdict == "FAIL"
    assert submission_error(with_reason) is None


def test_winder_does_not_reuse_finished_length_limits():
    evaluation = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=_winder_snapshot(),
        readings={"id": 77, "od": 91, "height": 150, "weight": 250, "cs": 320},
        require_reasons_on_fail=False,
    )
    height = next(row for row in evaluation.parameter_results if row.code == "height")
    assert height.verdict == "FAIL"
    assert "118" in (height.rule.allowed_display() if height.rule else "")
    assert "145" not in (height.rule.allowed_display() if height.rule else "")


def test_blank_and_invalid_never_pass():
    blank = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=_winder_snapshot(),
        readings={"id": 77, "od": 91, "height": "", "weight": 250, "cs": 320},
    )
    invalid = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=_winder_snapshot(),
        readings={"id": 77, "od": 91, "height": "n/a", "weight": 250, "cs": 320},
    )
    assert blank.verdict == "INCOMPLETE"
    assert invalid.verdict == "INVALID"
    assert all(row.verdict != "PASS" or row.code != "height" for row in blank.parameter_results)
    assert all(row.verdict != "PASS" or row.code != "height" for row in invalid.parameter_results)


def test_oven_requires_paired_sample_for_post_readings():
    evaluation = evaluate_job_stage(
        stage="OVEN",
        spec_snapshot=_winder_snapshot(),
        readings={"pre_weight": 240, "post_weight": 220, "pre_moisture": 10, "post_moisture": 6},
        sample_id="",
        require_reasons_on_fail=False,
    )
    assert evaluation.verdict == "INCOMPLETE"
    paired = evaluate_job_stage(
        stage="OVEN",
        spec_snapshot=_winder_snapshot(),
        readings={"pre_weight": 240, "post_weight": 220, "pre_moisture": 10, "post_moisture": 6},
        sample_id="OVEN-A1",
    )
    assert paired.verdict == "PASS"


def test_process_notch_conditional_and_moisture():
    snapshot = _winder_snapshot()
    snapshot["notch_capability_required"] = False
    evaluation = evaluate_job_stage(
        stage="PROCESS",
        spec_snapshot=snapshot,
        readings={"height": 120, "weight": 230, "cs": 320, "moisture": 6},
    )
    notch = next(row for row in evaluation.parameter_results if row.code == "notch_distance")
    assert notch.verdict == "NOT_APPLICABLE"
    assert evaluation.verdict == "PASS"


def test_missing_frozen_profile_cannot_pass():
    evaluation = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot={"length_min_mm": 145, "length_max_mm": 155},
        readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320},
    )
    assert evaluation.verdict == "INCOMPLETE"


def test_incoming_uses_item_profile_and_ignores_reason_pass():
    profile = {
        "setup_status": "complete",
        "parameters": [{"code": "moisture", "label": "Moisture", "unit": "%", "min": 6, "max": 8}],
    }
    passed = evaluate_incoming(profile=profile, readings={"moisture": 7})
    failed = evaluate_incoming(
        profile=profile,
        readings={"moisture": 12},
        reasons={"moisture": "wet lot"},
    )
    assert passed.verdict == "PASS"
    assert failed.verdict == "FAIL"
    assert submission_error(failed) is None
