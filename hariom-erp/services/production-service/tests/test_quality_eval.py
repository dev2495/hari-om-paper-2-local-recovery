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


def test_oven_pre_only_checkpoint_does_not_require_post():
    evaluation = evaluate_job_stage(
        stage="OVEN",
        spec_snapshot=_winder_snapshot(),
        readings={"pre_weight": 240, "pre_moisture": 10, "oven_checkpoint": "PRE", "pre_specimen_id": "S1"},
        sample_id="S1",
        require_reasons_on_fail=False,
    )
    assert evaluation.verdict == "PASS"
    post_codes = {row.code: row.verdict for row in evaluation.parameter_results}
    assert post_codes["post_weight"] == "NOT_APPLICABLE"


def test_oven_post_checkpoint_requires_post_and_pre_context():
    missing_post = evaluate_job_stage(
        stage="OVEN",
        spec_snapshot=_winder_snapshot(),
        readings={"pre_weight": 240, "pre_moisture": 10, "oven_checkpoint": "POST", "pre_specimen_id": "S1"},
        sample_id="S1",
        require_reasons_on_fail=False,
    )
    assert missing_post.verdict != "PASS"
    post = {row.code: row.verdict for row in missing_post.parameter_results}
    assert post["post_weight"] == "INCOMPLETE"
    no_pre = evaluate_job_stage(
        stage="OVEN",
        spec_snapshot=_winder_snapshot(),
        readings={"post_weight": 220, "post_moisture": 6, "oven_checkpoint": "POST", "post_specimen_id": "S2"},
        sample_id="S2",
        require_reasons_on_fail=False,
    )
    assert no_pre.verdict != "PASS"
    assert any(row.code == "oven_pair" and row.verdict == "INCOMPLETE" for row in no_pre.parameter_results)


def test_oven_pair_mismatch_fails():
    evaluation = evaluate_job_stage(
        stage="OVEN",
        spec_snapshot=_winder_snapshot(),
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


def test_categorical_fail_uses_approved_outcomes():
    from src.quality_eval import evaluate_parameter, ParameterRule

    rule = ParameterRule(
        code="color_bleeding",
        label="Color Bleeding",
        unit="",
        input_type="select",
        options=["PASS", "FAIL"],
        required=True,
    )
    failed = evaluate_parameter(rule, "BLEED")
    passed = evaluate_parameter(rule, "PASS")
    assert failed.verdict == "INVALID"
    assert passed.verdict == "PASS"


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


def test_inverted_bounds_are_invalid_not_pass():
    snapshot = _winder_snapshot()
    snapshot["qc_profile"]["stages"]["WINDER"]["parameters"][2] = {
        "code": "height",
        "label": "Height",
        "unit": "mm",
        "min": 122,
        "max": 118,
    }
    evaluation = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=snapshot,
        readings={"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320},
        require_reasons_on_fail=False,
    )
    height = next(row for row in evaluation.parameter_results if row.code == "height")
    assert height.verdict == "INVALID"
    assert evaluation.verdict == "INVALID"


def test_kg_batch_weight_is_not_an_alias_for_g_specimen():
    evaluation = evaluate_job_stage(
        stage="OVEN",
        spec_snapshot=_winder_snapshot(),
        readings={"pre_oven_weight_kg": 1.2, "pre_moisture": 10, "oven_checkpoint": "PRE", "pre_specimen_id": "S1"},
        sample_id="S1",
        require_reasons_on_fail=False,
    )
    pre = next(row for row in evaluation.parameter_results if row.code == "pre_weight")
    assert pre.verdict == "INCOMPLETE"
    assert evaluation.verdict == "INCOMPLETE"


def test_fail_without_reason_is_measured_fail_not_rejected_evidence():
    evaluation = evaluate_job_stage(
        stage="WINDER",
        spec_snapshot=_winder_snapshot(),
        readings={"id": 77, "od": 91, "height": 150, "weight": 250, "cs": 320},
        reasons={},
        require_reasons_on_fail=True,
    )
    assert evaluation.verdict == "FAIL"
    assert evaluation.status == "FAIL"
    assert submission_error(evaluation)


def test_rr04_client_hold_flag_is_ignored_in_router():
    from pathlib import Path

    text = Path(__file__).resolve().parents[1].joinpath("src/routers/quality.py").read_text()
    assert "The client create_hold_on_fail flag is ignored" in text
    assert "if evaluation.status in {\"FAIL\", \"INVALID\"}:" in text


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
