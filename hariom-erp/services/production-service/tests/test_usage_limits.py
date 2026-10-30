"""Usage limits: spec defaults and the allowed-gap rule (client 2026-10-28, spec 2.1)."""
from src.services.usage_limits import (
    DEFAULT_USAGE_LIMITS,
    allowed_gap,
    expected_use,
    gap_status,
    usage_limit_type,
)


def test_spec_defaults_per_material_type():
    assert DEFAULT_USAGE_LIMITS["RAW_PAPER"] == {"normal_wastage_pct": 7.0, "allowed_gap_pct": 7.0, "min_gap": 5.0}
    assert {key: row["normal_wastage_pct"] for key, row in DEFAULT_USAGE_LIMITS.items()} == {
        "RAW_PAPER": 7.0, "ADHESIVE": 0.0, "PARCHMENT": 0.0, "PACKAGING": 0.0, "OTHER": 0.0}
    assert {row["allowed_gap_pct"] for row in DEFAULT_USAGE_LIMITS.values()} == {7.0}
    assert {key: row["min_gap"] for key, row in DEFAULT_USAGE_LIMITS.items()} == {
        "RAW_PAPER": 5.0, "ADHESIVE": 0.5, "PARCHMENT": 1.0, "PACKAGING": 10.0, "OTHER": 5.0}
    assert usage_limit_type("raw_paper") == "RAW_PAPER"
    assert usage_limit_type("FINISHED_GOOD") == "OTHER" and usage_limit_type(None) == "OTHER"


def test_expected_use_and_allowed_gap_in_the_items_unit():
    paper = DEFAULT_USAGE_LIMITS["RAW_PAPER"]
    expected = expected_use(1000, paper)
    assert round(expected, 6) == 1070.0
    # 7% of 1,070 kg = 74.9 kg beats the 5 kg minimum; a 20 kg spec only gets the minimum.
    assert round(allowed_gap(expected, paper), 6) == 74.9
    assert allowed_gap(expected_use(20, paper), paper) == 5.0
    packing = DEFAULT_USAGE_LIMITS["PACKAGING"]
    assert expected_use(40, packing) == 40.0 and allowed_gap(40, packing) == 10.0


def test_status_against_the_allowed_gap():
    assert gap_status(None, 5) == "NOT_KNOWN"
    assert gap_status(5, 5) == "OK" and gap_status(-5, 5) == "OK"
    assert gap_status(5.01, 5) == "OVER"
    assert gap_status(-5.01, 5) == "UNDER"
