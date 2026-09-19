import pytest

from src.qc_profile import normalize_qc_profile, profile_status


def test_normalize_persists_explicit_gating_and_does_not_invent_advisory():
    profile = normalize_qc_profile(
        {
            "stages": {
                "WINDER": {
                    "gating": "advisory",
                    "parameters": [
                        {"code": "height", "min": 118, "max": 122, "unit": "mm", "gating": "blocking"},
                    ],
                }
            }
        }
    )
    assert profile["stages"]["WINDER"]["gating"] == "advisory"
    height = next(row for row in profile["stages"]["WINDER"]["parameters"] if row["code"] == "height")
    assert height["gating"] == "blocking"
    id_row = next(row for row in profile["stages"]["WINDER"]["parameters"] if row["code"] == "id")
    assert "gating" not in id_row

    omitted = normalize_qc_profile(
        {
            "stages": {
                "WINDER": {
                    "parameters": [
                        {"code": "height", "min": 118, "max": 122, "unit": "mm"},
                    ]
                }
            }
        }
    )
    assert "gating" not in omitted["stages"]["WINDER"]
    omitted_height = next(row for row in omitted["stages"]["WINDER"]["parameters"] if row["code"] == "height")
    assert "gating" not in omitted_height


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


def test_normalize_keeps_requires_instrument_and_does_not_invent_calibration():
    profile = normalize_qc_profile(
        {
            "stages": {
                "WINDER": {
                    "parameters": [
                        {
                            "code": "height",
                            "min": 118,
                            "max": 122,
                            "unit": "mm",
                            "requires_instrument": True,
                            "required_instrument_id": "CAL-HEIGHT-01",
                        },
                    ]
                }
            }
        }
    )
    height = next(row for row in profile["stages"]["WINDER"]["parameters"] if row["code"] == "height")
    assert height["requires_instrument"] is True
    assert height["required_instrument_id"] == "CAL-HEIGHT-01"
    assert height.get("calibration_due") in (None, "", False)
    id_row = next(row for row in profile["stages"]["WINDER"]["parameters"] if row["code"] == "id")
    assert id_row["requires_instrument"] is False


def test_canonical_client_labels_replace_generic_substitutes():
    from src.qc_profile import EXACT_STAGE_LABELS, GENERIC_FORBIDDEN_LABELS, normalize_qc_profile

    profile = normalize_qc_profile(
        {
            "stages": {
                "WINDER": {
                    "parameters": [
                        {"code": "id", "label": "Inner Diameter", "min": 76, "max": 78, "unit": "mm"},
                        {"code": "height", "label": "Length", "min": 118, "max": 122, "unit": "mm"},
                    ]
                }
            }
        },
        mutating=True,
    )
    labels = {row["code"]: row["label"] for row in profile["stages"]["WINDER"]["parameters"]}
    assert labels["id"] == "I.D."
    assert labels["height"] == "Height"
    assert labels["od"] == "O.D."
    assert labels["cs"] == "C.S."
    for stage, expected in EXACT_STAGE_LABELS.items():
        got = tuple(row["label"] for row in profile["stages"][stage]["parameters"])
        assert got == expected
        assert GENERIC_FORBIDDEN_LABELS.isdisjoint(got)


def test_verified_non_notched_is_not_applicable_not_zero():
    from src.qc_profile import NOT_APPLICABLE_LABEL, normalize_qc_profile, notching_review_required, profile_status, project_qc_read_contract

    profile = normalize_qc_profile(
        {
            "notching_applicable": False,
            "stages": {
                "PROCESS": {
                    "parameters": [
                        {"code": "notch_distance", "min": 0, "max": 0, "applicable": True},
                        {"code": "notch_depth", "min": 0, "max": 0, "applicable": True},
                    ]
                }
            }
        },
        mutating=True,
    )
    distance = next(row for row in profile["stages"]["PROCESS"]["parameters"] if row["code"] == "notch_distance")
    depth = next(row for row in profile["stages"]["PROCESS"]["parameters"] if row["code"] == "notch_depth")
    assert distance["applicable"] is False
    assert distance["min"] is None
    assert distance["max"] is None
    assert depth["min"] is None
    projected = project_qc_read_contract(profile)
    shown = next(row for row in projected["stages"]["PROCESS"]["parameters"] if row["code"] == "notch_distance")
    assert shown["applicability_label"] == NOT_APPLICABLE_LABEL
    assert shown["min"] is None
    assert notching_review_required(profile) is False


def test_unknown_notching_requires_review_not_auto_skip():
    from src.qc_profile import normalize_qc_profile, notching_review_required, profile_status

    profile = normalize_qc_profile(
        {
            "stages": {
                "WINDER": {"parameters": [{"code": "height", "min": 118, "max": 122, "unit": "mm"}]}
            }
        },
        mutating=True,
    )
    distance = next(row for row in profile["stages"]["PROCESS"]["parameters"] if row["code"] == "notch_distance")
    assert distance["applicable"] is None
    assert distance["min"] is None
    assert notching_review_required(profile) is True
    assert profile_status(profile) not in {"complete", "approved"}


def test_stage_basis_hints_are_stage_specific():
    from src.qc_profile import STAGE_PARAMETER_DEFS, normalize_qc_profile

    winding = next(item for item in STAGE_PARAMETER_DEFS["WINDER"] if item["code"] == "height")
    process = next(item for item in STAGE_PARAMETER_DEFS["PROCESS"] if item["code"] == "height")
    assert winding["basis_hint"] == "Height at winding"
    assert process["basis_hint"] == "Finished height"
    profile = normalize_qc_profile(
        {
            "stages": {
                "WINDER": {
                    "parameters": [{"code": "height", "specimen": "winding caliper", "min": 100, "max": 110}]
                },
                "PROCESS": {
                    "parameters": [{"code": "height", "specimen": "finished tube", "min": 118, "max": 122}]
                },
            }
        }
    )
    winding_row = next(row for row in profile["stages"]["WINDER"]["parameters"] if row["code"] == "height")
    process_row = next(row for row in profile["stages"]["PROCESS"]["parameters"] if row["code"] == "height")
    assert winding_row["specimen"] == "winding caliper"
    assert process_row["specimen"] == "finished tube"
    assert winding_row["min"] != process_row["min"]


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


def test_incomplete_draft_save_is_not_approved_or_qc_ready():
    profile = normalize_qc_profile(
        {
            "status": "draft",
            "stages": {
                "WINDER": {
                    "parameters": [
                        {"code": "id", "unit": "mm"},
                        {"code": "od", "unit": "mm"},
                    ]
                }
            },
        }
    )
    assert profile["status"] == "draft"
    assert profile_status(profile) == "draft"
    height = next(row for row in profile["stages"]["WINDER"]["parameters"] if row["code"] == "height")
    assert height["min"] is None
    assert height["max"] is None
    assert profile_status(profile) not in {"approved", "complete"}
    empty = normalize_qc_profile({"status": "complete", "stages": {}})
    assert profile_status(empty) != "complete"
