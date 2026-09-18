from src.quality_pin import pin_quality_profile_metadata


def test_qct015_pin_keeps_per_item_bounds_not_a_shared_category_preset():
    paper_a = {
        "status": "approved",
        "revision": 1,
        "parameters": [{"code": "gsm", "min": 180, "max": 200}],
    }
    paper_b = {
        "status": "approved",
        "revision": 1,
        "parameters": [{"code": "gsm", "min": 80, "max": 100}],
    }
    pin_a = pin_quality_profile_metadata({}, paper_a)
    pin_b = pin_quality_profile_metadata({}, paper_b)
    assert pin_a["quality_profile"]["parameters"][0]["min"] == 180
    assert pin_b["quality_profile"]["parameters"][0]["min"] == 80
    later = pin_quality_profile_metadata(pin_a, paper_b)
    assert later["quality_profile"]["parameters"][0]["min"] == 180
