"""Original QCT-001..014 evaluator contract (shared engine, both service copies).

These cases evaluate the typed rule engine. UI adapters remain separately mapped.
"""
from __future__ import annotations

import hashlib
from decimal import Decimal
from math import inf, nan
from pathlib import Path

import pytest

from hariom_quality_eval import (
    ParameterRule,
    evaluate_incoming,
    evaluate_job_stage,
    evaluate_parameter,
    parse_finite_number,
)


ROOT = Path(__file__).resolve().parents[1]
COPIES = [
    ROOT / "hariom_quality_eval.py",
    ROOT.parent / "services" / "production-service" / "shared" / "hariom_quality_eval.py",
    ROOT.parent / "services" / "inventory-service" / "shared" / "hariom_quality_eval.py",
]


def _rule(**kwargs) -> ParameterRule:
    defaults = dict(code="height", label="Height", unit="mm", lower=Decimal("118"), upper=Decimal("122"))
    defaults.update(kwargs)
    return ParameterRule(**defaults)


def test_qct014_packaged_evaluator_copies_are_byte_identical():
    hashes = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in COPIES}
    assert len(set(hashes.values())) == 1, hashes


def test_qct001_two_sided_inclusive_and_exclusive_endpoints():
    inclusive = _rule(inclusive_min=True, inclusive_max=True)
    assert evaluate_parameter(inclusive, "118").verdict == "PASS"
    assert evaluate_parameter(inclusive, "122").verdict == "PASS"
    assert evaluate_parameter(inclusive, "117.999").verdict == "FAIL"
    assert evaluate_parameter(inclusive, "122.001").verdict == "FAIL"

    exclusive = _rule(inclusive_min=False, inclusive_max=False)
    assert evaluate_parameter(exclusive, "118").verdict == "FAIL"
    assert evaluate_parameter(exclusive, "122").verdict == "FAIL"
    assert evaluate_parameter(exclusive, "118.001").verdict == "PASS"
    assert evaluate_parameter(exclusive, "121.999").verdict == "PASS"
    failed = evaluate_parameter(exclusive, "118")
    assert "epsilon" not in failed.message.lower()
    assert "118" in failed.message


def test_qct002_minimum_only_never_disables_when_max_missing():
    rule = _rule(lower=Decimal("10"), upper=None, inclusive_min=True)
    assert evaluate_parameter(rule, "9.999").verdict == "FAIL"
    assert evaluate_parameter(rule, "10").verdict == "PASS"
    assert evaluate_parameter(rule, "100000").verdict == "PASS"


def test_qct003_maximum_only_enforced_independently():
    rule = _rule(lower=None, upper=Decimal("8"), inclusive_max=False)
    assert evaluate_parameter(rule, "8").verdict == "FAIL"
    assert evaluate_parameter(rule, "7.999").verdict == "PASS"
    assert evaluate_parameter(rule, "8.001").verdict == "FAIL"


def test_qct006_malformed_and_non_finite_never_pass():
    rule = _rule()
    samples = [None, "", "   ", "n/a", "abc", nan, inf, -inf, True, False, "NaN", "Infinity", "+inf"]
    for sample in samples:
        result = evaluate_parameter(rule, sample)
        assert result.verdict != "PASS", sample
        assert result.verdict in {"INCOMPLETE", "INVALID"}


def test_qct007_zero_is_evaluated_and_missing_is_incomplete():
    rule = _rule(lower=Decimal("0"), upper=Decimal("10"))
    zero = evaluate_parameter(rule, 0)
    omitted = evaluate_parameter(rule, None)
    whitespace = evaluate_parameter(rule, "  ")
    assert zero.verdict == "PASS"
    assert zero.numeric_value == 0.0
    assert omitted.verdict == "INCOMPLETE"
    assert whitespace.verdict == "INCOMPLETE"
    number, error = parse_finite_number("0")
    assert error is None and number == Decimal("0")
    _, missing = parse_finite_number("")
    assert missing == "blank"


def test_qct008_rounding_edge_stays_fail_with_explanatory_precision():
    rule = _rule(lower=Decimal("50"), upper=Decimal("55"))
    result = evaluate_parameter(rule, "55.0001")
    assert result.verdict == "FAIL"
    assert result.numeric_value == pytest.approx(55.0001)
    assert "55.0001" in result.message or "55.0" in result.message
    assert "Allowed" in result.message


def test_qct009_categorical_and_boolean_unknowns_are_invalid():
    categorical = ParameterRule(
        code="color_bleeding",
        label="Color Bleeding",
        unit="",
        input_type="select",
        options=["PASS", "FAIL"],
        required=True,
    )
    assert evaluate_parameter(categorical, "PASS").verdict == "PASS"
    assert evaluate_parameter(categorical, "FAIL").verdict == "FAIL"
    unknown = evaluate_parameter(categorical, "BLEED")
    assert unknown.verdict == "INVALID"
    boolean_rule = ParameterRule(
        code="lamination",
        label="Lamination present",
        unit="",
        input_type="boolean",
        options=["true", "false"],
        required=True,
    )
    assert evaluate_parameter(boolean_rule, True).verdict in {"PASS", "INVALID"}
    text_pass = evaluate_parameter(boolean_rule, "maybe")
    assert text_pass.verdict != "PASS"


def test_qct010_descriptive_only_is_observation_not_measured_pass():
    rule = ParameterRule(
        code="notes",
        label="Visual notes",
        unit="",
        input_type="text",
        required=False,
        lower=None,
        upper=None,
    )
    result = evaluate_parameter(rule, "surface scuff on one end")
    assert result.verdict == "OBSERVATION_ONLY"
    assert result.verdict != "PASS"


def test_qct011_kg_alias_does_not_satisfy_gram_rule():
    snapshot = {
        "qc_profile": {
            "revision": 1,
            "stages": {
                "OVEN": {
                    "parameters": [
                        {"code": "pre_weight", "label": "Pre-weight", "unit": "g", "min": 200, "max": 260},
                        {"code": "pre_moisture", "label": "Pre-moisture", "unit": "%", "min": 8, "max": 12},
                    ]
                }
            },
        }
    }
    evaluation = evaluate_job_stage(
        stage="OVEN",
        spec_snapshot=snapshot,
        readings={"pre_oven_weight_kg": 0.24, "pre_moisture": 10, "oven_checkpoint": "PRE", "pre_specimen_id": "S1"},
        sample_id="S1",
        require_reasons_on_fail=False,
    )
    pre = next(row for row in evaluation.parameter_results if row.code == "pre_weight")
    assert pre.verdict == "INCOMPLETE"
    assert evaluation.verdict != "PASS"


def test_qct013_evaluator_does_not_execute_payload_code():
    rule = _rule()
    sneaky = evaluate_parameter(rule, "__import__('os').system('true')")
    assert sneaky.verdict == "INVALID"


def test_qct014_incoming_and_job_adapters_share_golden_numeric_contract():
    profile = {
        "setup_status": "complete",
        "revision": 7,
        "parameters": [{"code": "gsm", "label": "GSM", "unit": "gsm", "min": 200, "max": 260, "inclusive_min": True, "inclusive_max": True}],
    }
    incoming_pass = evaluate_incoming(profile=profile, readings={"gsm": 200})
    incoming_fail = evaluate_incoming(profile=profile, readings={"gsm": 199.999})
    incoming_blank = evaluate_incoming(profile=profile, readings={"gsm": " "})
    snapshot = {
        "qc_profile": {
            "revision": 7,
            "stages": {
                "WINDER": {
                    "parameters": [
                        {"code": "id", "min": 200, "max": 260, "unit": "mm", "inclusive_min": True, "inclusive_max": True},
                    ]
                }
            },
        }
    }
    job_pass = evaluate_job_stage(stage="WINDER", spec_snapshot=snapshot, readings={"id": 200}, require_reasons_on_fail=False)
    job_fail = evaluate_job_stage(stage="WINDER", spec_snapshot=snapshot, readings={"id": 199.999}, require_reasons_on_fail=False)
    job_blank = evaluate_job_stage(stage="WINDER", spec_snapshot=snapshot, readings={"id": " "}, require_reasons_on_fail=False)
    assert incoming_pass.verdict == job_pass.verdict == "PASS"
    assert incoming_fail.verdict == job_fail.verdict == "FAIL"
    assert incoming_blank.verdict == job_blank.verdict == "INCOMPLETE"
    assert incoming_pass.profile_revision == 7
    assert job_pass.profile_revision == 7
