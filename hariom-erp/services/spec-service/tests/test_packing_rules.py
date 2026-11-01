"""Spec packing from the Packaging masters (owner decision 5): approval blockers and amendment values."""
import pytest
from fastapi import HTTPException

from src.packing import amended_packing_values, changed_keys, current_packing, packing_blockers

MASTERS = {
    "R-150": {"kind": "BOX", "code": "R-150", "size_label": "400x300x200", "weight_kg": 0.45},
    "R.125": {"kind": "BOX", "code": "R.125", "size_label": "350x300", "weight_kg": None},
    "PS-150": {"kind": "PLASTIC", "code": "PS-150", "size_label": "1x1 m", "weight_kg": 0.05},
    "FD-3": {"kind": "FADDA", "code": "FD-3", "size_label": None, "weight_kg": 0.02},
}


def values(**changes):
    base = dict(box_code="r-150", qty_per_box=48, plastic_sku="PS-150", plastic_per_box=1, fadda_sku="FD-3", fadda_per_box=3, masters=MASTERS)
    return amended_packing_values(**{**base, **changes})


def test_box_and_qty_per_box_are_required_for_approval():
    assert packing_blockers({}) == [
        "Packing: choose the box from the Packaging master",
        "Packing: enter the quantity per box (whole pieces)",
    ]
    assert packing_blockers({"box": "R-150", "qty_per_box": "0"}) == ["Packing: enter the quantity per box (whole pieces)"]
    assert packing_blockers({"box_code": "R-150", "qty_per_box": "47.5"}) == ["Packing: enter the quantity per box (whole pieces)"]
    assert packing_blockers({"box_code": "R-150", "qty_per_box": "48"}) == []


def test_amendment_takes_sizes_and_unit_weights_from_the_masters():
    result = values()
    assert result["box_code"] == result["box"] == "R-150"
    assert result["box_size"] == "400x300x200" and result["box_unit_weight_kg"] == "0.45"
    assert result["qty_per_box"] == "48"
    assert result["plastic_required"] == "true" and result["plastic_size"] == "1x1 m"
    assert result["plastic_unit_weight_kg"] == "0.05" and result["plastic_weight_per_box_kg"] == "0.05"
    assert result["fadda_unit_weight_kg"] == "0.02" and result["fadda_weight_per_box_kg"] == "0.06" and result["fadda_per_box"] == "3"


def test_no_plastic_or_fadda_clears_their_weights():
    result = values(plastic_sku="", plastic_per_box=0, fadda_sku=None, fadda_per_box=None)
    assert result["plastic_required"] == "false" and result["plastic_sku"] == "" and result["plastic_per_box"] == "0"
    assert result["plastic_unit_weight_kg"] == "" and result["fadda_weight_per_box_kg"] == "" and result["fadda_per_box"] == "0"


def test_master_weight_blank_is_kept_blank_not_zero():
    result = values(box_code="R.125")
    assert result["box_unit_weight_kg"] == ""


@pytest.mark.parametrize(
    "changes, message",
    [
        ({"box_code": "N-225"}, "not an active box"),
        ({"box_code": ""}, "Choose the box"),
        ({"box_code": "PS-150"}, "not an active box"),
        ({"qty_per_box": 0}, "whole number"),
        ({"qty_per_box": 12.5}, "whole number"),
        ({"plastic_sku": "", "plastic_per_box": 1}, "Choose the plastic"),
        ({"plastic_sku": "PS-150", "plastic_per_box": 0}, "how many plastic"),
        ({"fadda_sku": "FD-9"}, "not an active fadda"),
        ({"fadda_per_box": -1}, "cannot be negative"),
    ],
)
def test_amendment_rejects_codes_outside_the_master_and_bad_counts(changes, message):
    with pytest.raises(HTTPException) as error:
        values(**changes)
    assert error.value.status_code == 422
    detail = error.value.detail
    assert message in (detail["message"] if isinstance(detail, dict) else detail)


def test_missing_box_error_names_the_code_for_the_add_box_link():
    with pytest.raises(HTTPException) as error:
        values(box_code="r.150")
    assert error.value.detail["code"] == "PACKAGING_MASTER_MISSING" and error.value.detail["missing_code"] == "R.150"


def test_changed_keys_ignore_unchanged_values():
    result = values()
    assert changed_keys(dict(result), result) == []
    assert changed_keys({**result, "qty_per_box": "45"}, result) == ["qty_per_box"]
    assert current_packing(result)["qty_per_box"] == 48.0
