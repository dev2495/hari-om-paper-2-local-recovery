import pytest

from src.quality_profile_lifecycle import ProfileLifecycleError, apply_profile_approve, apply_tolerance_adjustment


def approved_profile():
    return {
        "revision": 3,
        "status": "approved",
        "setup_status": "approved",
        "parameters": [
            {"code": "gsm", "label": "GSM", "unit": "g/m²", "input_type": "number", "min": 115, "max": 125, "required": True},
            {"code": "visual", "label": "Visual", "input_type": "select", "options": ["OK", "NG"], "required": True},
        ],
    }


def test_masters_rebands_existing_parameter_as_pending_revision():
    after = apply_tolerance_adjustment(approved_profile(), [{"code": "gsm", "min": 112, "max": 128}], expected_revision=3, note="Supplier B")
    assert after["revision"] == 4
    assert after["status"] == "pending_review"
    gsm = next(row for row in after["parameters"] if row["code"] == "gsm")
    assert (gsm["min"], gsm["max"]) == (112, 128)
    # The approved revision keeps governing receipts until Owner/Admin approval.
    assert after["approved_snapshot"]["parameters"][0]["min"] == 115
    assert after["last_adjustment"]["parameters"] == ["gsm"]
    approved = apply_profile_approve(after, expected_revision=4, actor="owner@x", actor_roles=["Owner"])
    assert approved["status"] == "approved"


def test_masters_cannot_add_parameters_or_band_categorical_checks():
    with pytest.raises(ProfileLifecycleError) as missing:
        apply_tolerance_adjustment({"revision": 1, "parameters": []}, [{"code": "gsm", "min": 1}], expected_revision=1)
    assert missing.value.code == "QC_PARAMETERS_MISSING"
    with pytest.raises(ProfileLifecycleError) as unknown:
        apply_tolerance_adjustment(approved_profile(), [{"code": "moisture", "max": 9}], expected_revision=3)
    assert unknown.value.code == "UNKNOWN_PARAMETER"
    with pytest.raises(ProfileLifecycleError) as categorical:
        apply_tolerance_adjustment(approved_profile(), [{"code": "visual", "min": 1}], expected_revision=3)
    assert categorical.value.code == "NOT_NUMERIC"


def test_masters_band_rules():
    with pytest.raises(ProfileLifecycleError) as inverted:
        apply_tolerance_adjustment(approved_profile(), [{"code": "gsm", "min": 130, "max": 120}], expected_revision=3)
    assert inverted.value.code == "INVERTED_BAND"
    with pytest.raises(ProfileLifecycleError) as stale:
        apply_tolerance_adjustment(approved_profile(), [{"code": "gsm", "min": 110}], expected_revision=2)
    assert stale.value.code == "STALE_REVISION"
    with pytest.raises(ProfileLifecycleError) as empty:
        apply_tolerance_adjustment(approved_profile(), [{"code": "gsm", "min": None, "max": None}], expected_revision=3)
    assert empty.value.code == "BAND_REQUIRED"
    with pytest.raises(ProfileLifecycleError) as unchanged:
        apply_tolerance_adjustment(approved_profile(), [{"code": "gsm", "min": 115, "max": 125}], expected_revision=3)
    assert unchanged.value.code == "NO_CHANGE"
