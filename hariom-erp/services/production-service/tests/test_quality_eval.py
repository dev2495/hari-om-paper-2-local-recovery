from src.quality_eval import (
    apply_qc_setup_marker,
    evaluate_incoming,
    evaluate_job_stage,
    instrument_readiness_for_snapshot,
    missing_qc_setup_blocks_checkpoint,
    qc_profile_setup_status,
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
    assert "if evaluation.status in {\"FAIL\", \"INVALID\"} and not correcting_existing_fail:" in text
    assert '@router.post("/supervisor/inspections"' in text
    assert '@router.post("/eod/inspections"' in text
    assert '@router.post("/inspections/import"' in text
    assert '@router.post("/legacy/inspections"' in text


def test_qct063_replay_lock_unique_fingerprint_and_quantity_scope():
    from pathlib import Path

    router = Path(__file__).resolve().parents[1].joinpath("src/routers/quality.py").read_text()
    main = Path(__file__).resolve().parents[1].joinpath("src/main.py").read_text()
    assert "pg_advisory_xact_lock(hashtextextended(:key, 0))" in router
    assert "_reuse_recorded_inspection" in router
    assert 'evaluation_payload["affected_quantity"]' in router
    assert "_active_hold_for_sample_scope" in router
    assert "uq_quality_inspections_observation_fingerprint" in main
    assert "_to_inspection_response(row, hold=_active_hold_for_inspection(db, row), reused=False)" in router


def test_observation_fingerprint_ignores_client_shortcut_pass():
    import uuid

    from src.routers.quality import observation_fingerprint

    job_id = uuid.uuid4()
    measured = {"id": 77, "od": 91, "height": 90, "weight": 250, "cs": 100}
    reasons = {"height": "measured short"}
    base = observation_fingerprint(
        job_card_id=job_id,
        stage_type="WINDER",
        sample_id="ADAPTER-1",
        readings=measured,
        reasons=reasons,
    )
    shortcut = observation_fingerprint(
        job_card_id=job_id,
        stage_type="WINDER",
        sample_id="ADAPTER-1",
        readings={**measured, "overall": "PASS", "status": "PASS", "disposition": "RELEASED", "stock_status": "UNRESTRICTED"},
        reasons=reasons,
    )
    assert base == shortcut
    assert len(base) == 64


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


def test_complete_card_returns_hidden_stage_issues_when_visible_tab_is_valid():
    from src.routers.quality import collect_complete_card_issues

    snapshot = _winder_snapshot()
    winder = {"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320}
    omitted_hidden = collect_complete_card_issues(
        spec_snapshot=snapshot,
        submitted_stages=[{"stage_type": "WINDER", "readings": winder, "reasons": {}, "sample_id": "W1"}],
        stored_rows=[],
    )
    stages = {row["stage"] for row in omitted_hidden}
    assert "OVEN" in stages
    assert "PROCESS" in stages
    assert not any(row["stage"] == "WINDER" and row["parameter"] == "height" for row in omitted_hidden)
    with_hidden_fail = collect_complete_card_issues(
        spec_snapshot=snapshot,
        submitted_stages=[{"stage_type": "WINDER", "readings": winder, "reasons": {}, "sample_id": "W1"}],
        stored_rows=[
            {
                "stage_type": "PROCESS",
                "readings": {
                    "height": 90,
                    "weight": 230,
                    "cs": 320,
                    "notch_distance": 25,
                    "notch_depth": 3,
                    "moisture": 6,
                },
                "reasons": {},
                "sample_id": "P1",
            }
        ],
    )
    process_height = next(row for row in with_hidden_fail if row["stage"] == "PROCESS" and row["parameter"] == "height")
    assert process_height["outcome"] == "FAIL"
    assert process_height["sample"] == "P1"
    assert any(row["stage"] == "OVEN" and row["outcome"] == "INCOMPLETE" for row in with_hidden_fail)


def test_unknown_cause_stays_open_and_does_not_require_fabricated_root_cause():
    from src.routers.quality import (
        CAUSE_UNDER_INVESTIGATION,
        _has_open_investigation,
        _normalize_reasons_map,
        _unknown_cause_gaps,
    )

    closed = _normalize_reasons_map(
        {
            "height": {
                "code": "CAUSE_UNDER_INVESTIGATION",
                "note": "winding height measured short vs Allowed 118-122 mm",
                "containment": "quarantine reel on hold location",
                "assignee": "qc.supervisor",
                "investigation_status": "CLOSED",
                "root_cause": "operator error",
                "rca_complete": True,
            }
        }
    )
    height = closed["height"]
    assert height["code"] == CAUSE_UNDER_INVESTIGATION
    assert height["investigation_status"] == "OPEN"
    assert "root_cause" not in height
    assert "rca_complete" not in height
    assert _unknown_cause_gaps(closed, ["height"]) == []
    assert _has_open_investigation(closed, ["height"]) is True

    incomplete = _normalize_reasons_map({"height": "Cause under investigation"})
    assert incomplete["height"]["code"] == CAUSE_UNDER_INVESTIGATION
    assert _unknown_cause_gaps(incomplete, ["height"]) == ["height"]

    ordinary = _normalize_reasons_map({"height": "core crushed during winding"})
    assert ordinary["height"] == "core crushed during winding"
    assert _unknown_cause_gaps(ordinary, ["height"]) == []
    assert _has_open_investigation(ordinary, ["height"]) is False


def test_common_cause_links_three_failures_without_losing_parameters():
    from src.routers.quality import _grouped_case_meta, _normalize_reasons_map

    grouped = _normalize_reasons_map(
        {
            "id": {"common_cause_id": "CASE-1"},
            "od": {"common_cause_id": "CASE-1"},
            "height": {"common_cause_id": "CASE-1"},
            "__common__": {
                "id": "CASE-1",
                "explanation": "crushed core during winding affected ID, OD and height",
                "containment": "hold the entire winder cage",
                "assignee": "qc.supervisor",
                "applies_to": ["id", "od", "height"],
            },
        }
    )
    case_id, linked = _grouped_case_meta(grouped)
    assert case_id == "CASE-1"
    assert set(linked) == {"id", "od", "height"}
    for code in ("id", "od", "height"):
        assert grouped[code]["common_cause_id"] == "CASE-1"
        assert grouped[code]["grouped"] is True
        assert "crushed core" in grouped[code]["explanation"]
        assert grouped[code]["containment"]
        assert grouped[code]["assignee"] == "qc.supervisor"
    assert grouped["__common__"]["common_cause_id"] == "CASE-1"


def test_changed_measured_values_detects_failing_number_correction():
    from src.routers.quality import _changed_measured_values, _observation_checkpoint

    changed = _changed_measured_values(
        {"id": 77, "od": 91, "height": 90, "weight": 250, "cs": 100},
        {"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 100},
    )
    assert changed == {"height": {"prior": 90, "replacement": 120}}

    oven_pair = _changed_measured_values(
        {"pre_weight": 1.5, "pre_moisture": 5, "oven_checkpoint": "PRE", "pre_specimen_id": "PAIR-A"},
        {"post_weight": 1.4, "post_moisture": 4, "oven_checkpoint": "POST", "post_specimen_id": "PAIR-A"},
    )
    assert oven_pair == {}
    assert _observation_checkpoint("OVEN", {"oven_checkpoint": "PRE"}) == "PRE"
    assert _observation_checkpoint("OVEN", {"oven_checkpoint": "POST"}) == "POST"

    completing_post = _changed_measured_values(
        {"oven_checkpoint": "POST", "post_specimen_id": "PAIR-A"},
        {"post_weight": 1.4, "post_moisture": 4, "oven_checkpoint": "POST", "post_specimen_id": "PAIR-A"},
    )
    assert completing_post == {}


def test_restricted_stock_actuals_rejects_client_unrestricted_label():
    from src.routers.planning import _restricted_stock_actuals

    out = _restricted_stock_actuals(
        {"stock_status": "UNRESTRICTED", "disposition": "RELEASED", "eligibility": "ELIGIBLE"}
    )
    assert out["stock_status"] == "QC_HOLD"
    assert out["eligibility"] == "BLOCKED"
    assert out["failed_qty_labelled_good"] is False
    assert out["physical_output_recorded"] is True
    assert out["quality_review_pending"] is True
    assert out["client_good_label_rejected"] is True
    assert out["disposition"] == "HOLD"


def test_late_exception_distinct_clocks_trace_without_retroactive_claim():
    from datetime import datetime

    from src.routers.quality import LATE_EXCEPTION_LABEL, late_exception_evaluation

    measured = datetime(2026, 9, 19, 6, 0, 0)
    recorded = datetime(2026, 9, 19, 10, 0, 0)
    out = late_exception_evaluation(
        measured_at=measured,
        recorded_at=recorded,
        verdict="FAIL",
        subsequent_stages=[{"kind": "WIP", "stage_type": "OVEN", "qty": 10}],
        surviving_stock=[{"kind": "FG", "qty": 4, "stock_status": "UNRESTRICTED"}],
        earlier_shipments=[{"dispatch_id": "ship-1", "status": "SEALED", "qty": 6}],
    )
    assert out["clocks_distinct"] is True
    assert out["measured_at"] != out["recorded_at"]
    assert out["late_quality_exception"] is True
    assert out["late_exception_label"] == LATE_EXCEPTION_LABEL
    assert out["surviving_stock"][0]["qty"] == 4
    assert out["earlier_shipments"][0]["qty"] == 6
    assert out["retroactive_prevention_claimed"] is False
    assert out["movement_already_occurred"] is True
    assert "not claim it was prevented" in str(out["late_exception_note"]).lower()

    passing = late_exception_evaluation(
        measured_at=measured,
        recorded_at=recorded,
        verdict="PASS",
        subsequent_stages=[{"stage_type": "OVEN", "qty": 10}],
        surviving_stock=[],
        earlier_shipments=[{"status": "SEALED", "qty": 6}],
    )
    assert passing["late_quality_exception"] is False
    assert passing["clocks_distinct"] is True
    assert passing["retroactive_prevention_claimed"] is False


def test_offline_draft_and_stale_reconnect_retain_observations_and_signed_context():
    from src.routers.quality import STALE_CONTEXT_MESSAGE, quality_reconnect_conflict, signed_profile_context

    first = signed_profile_context(
        {"qc_profile": {"revision": 1, "status": "approved", "stages": {"WINDER": {}}}, "quality_context_version": 1}
    )
    second = signed_profile_context(
        {"qc_profile": {"revision": 1, "status": "approved", "stages": {"WINDER": {}}}, "quality_context_version": 2}
    )
    assert first["quality_context_version"] == 1
    assert second["quality_context_version"] == 2
    assert first["profile_revision"] == 1
    assert first["fingerprint"]
    assert first["fingerprint"] != second["fingerprint"]
    observations = {
        "stage_type": "WINDER",
        "sample_id": "QCT059-1",
        "readings": {"height": 90},
        "reasons": {"height": "paper card height short"},
        "entry_mode": "OFFLINE_DRAFT",
    }
    offline = quality_reconnect_conflict(
        code="OFFLINE_RELEASE_FORBIDDEN",
        observations=observations,
        signed_profile_context=first,
        current_profile_context=first,
    )
    assert offline["offline_release"] is False
    assert offline["code"] == "OFFLINE_RELEASE_FORBIDDEN"
    assert offline["observations"]["readings"]["height"] == 90
    assert offline["signed_profile_context"]["fingerprint"] == first["fingerprint"]
    assert STALE_CONTEXT_MESSAGE in offline["message"]
    stale = quality_reconnect_conflict(
        code="STALE_CONTEXT",
        observations={**observations, "entry_mode": "PAPER_CARD"},
        signed_profile_context=first,
        current_profile_context=second,
    )
    assert stale["offline_release"] is False
    assert stale["observations"]["reasons"]["height"] == "paper card height short"
    assert stale["signed_profile_context"]["quality_context_version"] == 1
    assert stale["current_profile_context"]["quality_context_version"] == 2


def test_empty_qc_profile_is_missing_setup_and_never_pass():
    marked = apply_qc_setup_marker({"qc_profile": {}})
    assert marked["qc_setup_status"] == "missing"
    assert marked["missing_qc_setup"] is True
    assert marked["missing_profile_marker"] is True
    assert qc_profile_setup_status({}) == "missing"
    evaluation = evaluate_job_stage(stage="WINDER", spec_snapshot=marked, readings={"id": 77})
    assert evaluation.verdict != "PASS"
    assert missing_qc_setup_blocks_checkpoint(marked) is True


def test_approved_profile_is_not_missing_setup():
    snapshot = apply_qc_setup_marker(
        {
            "qc_profile": {
                "status": "approved",
                "approved_by": "qc-1",
                "revision": 2,
                "stages": {
                    "WINDER": {"parameters": [{"code": "id", "min": 76, "max": 78}]},
                },
            }
        }
    )
    assert snapshot["qc_setup_status"] == "approved"
    assert snapshot["missing_qc_setup"] is False
    assert missing_qc_setup_blocks_checkpoint(snapshot) is False


def test_legacy_approved_job_without_marker_still_executable():
    snapshot = {
        "qc_profile": {
            "status": "approved",
            "approved_by": "qc-1",
            "revision": 1,
            "stages": {"WINDER": {"parameters": [{"code": "id", "min": 1, "max": 2}]}},
        }
    }
    assert missing_qc_setup_blocks_checkpoint(snapshot) is False


def test_attached_marker_resolves_checkpoint():
    snapshot = apply_qc_setup_marker({"qc_profile": {}, "qc_setup_status": "attached"})
    assert snapshot["missing_qc_setup"] is False
    assert missing_qc_setup_blocks_checkpoint(snapshot) is False


def _instrument_snapshot():
    snapshot = _winder_snapshot()
    snapshot["qc_profile"]["status"] = "approved"
    snapshot["qc_profile"]["approved_by"] = "qc-1"
    height = next(
        row
        for row in snapshot["qc_profile"]["stages"]["WINDER"]["parameters"]
        if row["code"] == "height"
    )
    height["requires_instrument"] = True
    height["required_instrument_id"] = "CAL-HEIGHT-01"
    return snapshot


def test_required_instrument_missing_never_passes():
    snapshot = _instrument_snapshot()
    in_range = {"id": 77, "od": 91, "height": 120, "weight": 250, "cs": 320}
    evaluation = evaluate_job_stage(stage="WINDER", spec_snapshot=snapshot, readings=in_range)
    assert evaluation.verdict != "PASS"
    assert evaluation.verdict == "INVALID"
    readiness = instrument_readiness_for_snapshot(snapshot, "WINDER", in_range)
    assert readiness["required"] is True
    assert readiness["ready"] is False
    assert readiness["instrument_status"] == "missing"
    assert readiness["invented_calibration"] is False


def test_required_instrument_expired_never_passes():
    snapshot = _instrument_snapshot()
    readings = {
        "id": 77,
        "od": 91,
        "height": 120,
        "weight": 250,
        "cs": 320,
        "instrument": {
            "instrument_id": "CAL-HEIGHT-01",
            "calibration_status": "expired",
            "calibration_due": "2020-01-01",
            "evidence_ref": "CERT-OLD",
        },
    }
    evaluation = evaluate_job_stage(stage="WINDER", spec_snapshot=snapshot, readings=readings)
    assert evaluation.verdict != "PASS"
    readiness = instrument_readiness_for_snapshot(snapshot, "WINDER", readings)
    assert readiness["instrument_status"] == "expired"
    assert readiness["invented_calibration"] is False


def test_status_only_valid_without_evidence_is_not_invented_calibration():
    snapshot = _instrument_snapshot()
    readings = {
        "id": 77,
        "od": 91,
        "height": 120,
        "weight": 250,
        "cs": 320,
        "instrument": {"instrument_id": "CAL-HEIGHT-01", "calibration_status": "valid"},
    }
    evaluation = evaluate_job_stage(stage="WINDER", spec_snapshot=snapshot, readings=readings)
    assert evaluation.verdict != "PASS"
    readiness = instrument_readiness_for_snapshot(snapshot, "WINDER", readings)
    assert readiness["ready"] is False
    assert readiness["invented_calibration"] is False


def test_documented_in_cal_instrument_allows_measured_pass():
    snapshot = _instrument_snapshot()
    readings = {
        "id": 77,
        "od": 91,
        "height": 120,
        "weight": 250,
        "cs": 320,
        "instrument": {
            "instrument_id": "CAL-HEIGHT-01",
            "calibration_status": "valid",
            "calibration_due": "2099-12-31",
            "evidence_ref": "CERT-QCT062",
        },
    }
    evaluation = evaluate_job_stage(stage="WINDER", spec_snapshot=snapshot, readings=readings)
    assert evaluation.verdict == "PASS"
    readiness = instrument_readiness_for_snapshot(snapshot, "WINDER", readings)
    assert readiness["ready"] is True
    assert readiness["instrument_status"] == "valid"




