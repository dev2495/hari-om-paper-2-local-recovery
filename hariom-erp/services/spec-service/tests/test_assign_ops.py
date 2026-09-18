"""Unit coverage for bulk assign classification (QCT-037)."""
from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from src.assign_ops import classify_target, template_requires_notching


def test_mixed_applicable_and_notching_mismatch():
    template_id = uuid4()
    template_profile = {
        "notching_applicable": True,
        "stages": {
            "PROCESS": {
                "parameters": [
                    {"code": "notch_distance", "min": 10, "max": 12, "applicable": True, "required": True}
                ]
            }
        },
    }
    assert template_requires_notching(template_profile) is True
    applicable = SimpleNamespace(
        id=uuid4(),
        customer_name="legacy",
        status="draft",
        active=True,
        qc_profile=None,
    )
    mismatch = SimpleNamespace(
        id=uuid4(),
        customer_name="nonotch",
        status="draft",
        active=True,
        qc_profile={"notching_applicable": False},
    )
    retired = SimpleNamespace(
        id=uuid4(),
        customer_name="old",
        status="obsolete",
        active=False,
        qc_profile=None,
    )
    ok = classify_target(template_id=template_id, template_profile=template_profile, spec=applicable)
    bad = classify_target(template_id=template_id, template_profile=template_profile, spec=mismatch)
    dead = classify_target(template_id=template_id, template_profile=template_profile, spec=retired)
    assert ok["applicable"] is True
    assert ok["published"] is False
    assert ok["rewrites_issued_jobs"] is False
    assert bad["applicable"] is False
    assert bad["error"]["code"] == "NOTCHING_MISMATCH"
    assert dead["error"]["code"] == "SPEC_RETIRED"
