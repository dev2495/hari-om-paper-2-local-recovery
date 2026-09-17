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
