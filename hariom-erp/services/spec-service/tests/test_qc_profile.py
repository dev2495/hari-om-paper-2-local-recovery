import pytest

from src.qc_profile import normalize_qc_profile, profile_status


def test_normalize_keeps_submitted_bounds_and_does_not_invent():
    profile = normalize_qc_profile(
        {
            "stages": {
                "WINDER": {
                    "parameters": [
                        {"code": "height", "min": 118, "max": 122, "unit": "mm", "method": "caliper"},
                    ]
                }
            }
        }
    )
    height = next(row for row in profile["stages"]["WINDER"]["parameters"] if row["code"] == "height")
    assert height["min"] == 118
    assert height["max"] == 122
    assert height["method"] == "caliper"
    cs = next(row for row in profile["stages"]["WINDER"]["parameters"] if row["code"] == "cs")
    assert cs["min"] is None
    assert cs["max"] is None
    assert profile_status(profile) == "draft"


def test_complete_status_requires_all_required_bounds():
    raw = {
        "status": "complete",
        "stages": {
            "WINDER": {
                "parameters": [
                    {"code": "id", "min": 76, "max": 78, "unit": "mm"},
                    {"code": "od", "min": 90, "max": 92, "unit": "mm"},
                    {"code": "height", "min": 118, "max": 122, "unit": "mm"},
                    {"code": "weight", "min": 240, "max": 260, "unit": "g"},
                    {"code": "cs", "min": 300, "max": 340, "unit": "N"},
                ]
            },
            "OVEN": {
                "parameters": [
                    {"code": "pre_weight", "min": 200, "max": 260, "unit": "g"},
                    {"code": "post_weight", "min": 180, "max": 240, "unit": "g"},
                    {"code": "pre_moisture", "min": 8, "max": 12, "unit": "%"},
                    {"code": "post_moisture", "min": 4, "max": 8, "unit": "%"},
                ]
            },
            "PROCESS": {
                "parameters": [
                    {"code": "height", "min": 118, "max": 122, "unit": "mm"},
                    {"code": "weight", "min": 220, "max": 250, "unit": "g"},
                    {"code": "cs", "min": 300, "max": 340, "unit": "N"},
                    {"code": "notch_distance", "applicable": False},
                    {"code": "notch_depth", "applicable": False},
                    {"code": "moisture", "min": 5, "max": 8, "unit": "%"},
                ]
            },
        },
    }
    profile = normalize_qc_profile(raw)
    assert profile_status(profile) == "complete"


def test_inverted_and_malformed_bounds_are_rejected():
    from src.qc_profile import QcProfileError

    with pytest.raises(QcProfileError) as inverted:
        normalize_qc_profile(
            {
                "stages": {
                    "WINDER": {"parameters": [{"code": "height", "min": 122, "max": 118, "unit": "mm"}]}
                }
            },
            mutating=True,
        )
    assert inverted.value.code == "INVERTED_BOUNDS"
    with pytest.raises(QcProfileError) as malformed:
        normalize_qc_profile(
            {
                "stages": {
                    "WINDER": {"parameters": [{"code": "height", "min": "abc", "unit": "mm"}]}
                }
            },
            mutating=True,
        )
    assert malformed.value.code == "MALFORMED_BOUNDS"


def test_unsafe_rule_expression_is_rejected():
    from src.qc_profile import QcProfileError

    with pytest.raises(QcProfileError) as exc:
        normalize_qc_profile(
            {
                "stages": {
                    "WINDER": {
                        "parameters": [
                            {"code": "height", "min": 118, "max": 122, "unit": "mm", "formula": "height * 1.1"}
                        ]
                    }
                }
            },
            mutating=True,
        )
    assert exc.value.code == "UNSAFE_RULE"


def test_empty_categorical_accept_set_is_rejected():
    from src.qc_profile import QcProfileError

    with pytest.raises(QcProfileError) as exc:
        normalize_qc_profile(
            {
                "stages": {
                    "WINDER": {
                        "parameters": [
                            {"code": "height", "input_type": "select", "options": [], "unit": ""}
                        ]
                    }
                }
            },
            mutating=True,
        )
    assert exc.value.code == "EMPTY_ACCEPT_SET"


def test_client_approved_status_is_ignored_on_save():
    profile = normalize_qc_profile(
        {
            "status": "approved",
            "revision": 99,
            "stages": {
                "WINDER": {"parameters": [{"code": "height", "min": 118, "max": 122, "unit": "mm"}]}
            },
        },
        mutating=True,
    )
    assert profile["status"] != "approved"
    assert profile["revision"] == 1
