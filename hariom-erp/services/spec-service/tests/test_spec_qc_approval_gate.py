"""A spec cannot go live without a bounds-complete stage QC profile (A3)."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.routers import specs

OWNER = {"role": "Owner", "roles": ["Owner"], "sub": "owner-1", "token": "t"}


def _row(code, lo, hi, **extra):
    return {"code": code, "min": lo, "max": hi, "unit": "mm", "required": True, **extra}


def _complete_profile(status="complete"):
    return {
        "status": status,
        "revision": 1,
        "notching_applicable": False,
        "notching_review_required": False,
        "stages": {
            "WINDER": {"parameters": [_row(c, 1, 2) for c in ("id", "od", "height", "weight", "cs")]},
            "OVEN": {"parameters": [_row(c, 1, 2) for c in ("pre_weight", "post_weight", "pre_moisture", "post_moisture")]},
            "PROCESS": {
                "parameters": [
                    *[_row(c, 1, 2) for c in ("height", "weight", "cs", "moisture")],
                    {"code": "notch_distance", "min": None, "max": None, "applicable": False, "conditional": "notching"},
                    {"code": "notch_depth", "min": None, "max": None, "applicable": False, "conditional": "notching"},
                ]
            },
        },
    }


def _spec(qc):
    return SimpleNamespace(id="s1", status="review", qc_profile=qc, dynamic_values=[])


def test_missing_profile_blocks_submit_and_approval():
    assert specs._qc_profile_bounds_complete(_spec(None)) is False
    assert specs._qc_profile_bounds_complete(_spec({})) is False


def test_partial_profile_is_not_ready():
    profile = _complete_profile()
    profile["stages"]["OVEN"]["parameters"][0]["min"] = None
    profile["stages"]["OVEN"]["parameters"][0]["max"] = None
    assert specs._qc_profile_bounds_complete(_spec(profile)) is False


def test_draft_label_with_full_bounds_counts_as_ready():
    assert specs._qc_profile_bounds_complete(_spec(_complete_profile(status="draft"))) is True


def test_approving_in_place_stamps_approver_and_snapshot():
    spec = _spec(_complete_profile())
    specs._approve_qc_profile_in_place(spec, spec.qc_profile, OWNER)
    assert spec.qc_profile["status"] == "approved"
    assert spec.qc_profile["approved_by"] == "owner-1"
    assert spec.qc_profile["approved_snapshot"]["status"] == "approved"


def test_approving_incomplete_profile_is_refused():
    profile = _complete_profile()
    profile["stages"]["WINDER"]["parameters"] = []
    spec = _spec(profile)
    with pytest.raises(HTTPException) as error:
        specs._approve_qc_profile_in_place(spec, profile, OWNER)
    assert error.value.status_code == 400
