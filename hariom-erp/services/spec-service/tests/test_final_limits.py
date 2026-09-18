"""Unit coverage for canonical final-limit adapter (QCT-038)."""
from __future__ import annotations

from types import SimpleNamespace
from typing import Optional

import pytest
from fastapi import HTTPException
from pydantic import BaseModel

from src.final_limits import (
    extract_final_from_profile,
    merge_canonical_into_payload,
    project_final_block,
    reject_conflicting_final_writes,
    reject_qc_contractual_final,
)


class _Payload(BaseModel):
    id_min_mm: Optional[float] = None
    id_max_mm: Optional[float] = None
    qc_profile: Optional[dict] = None


def test_matching_new_editor_and_legacy_merge():
    payload = _Payload(id_min_mm=76.0, qc_profile={"final": {"id": {"min": 76.0, "max": 78.0}}})
    merge_canonical_into_payload(payload)
    assert payload.id_min_mm == 76.0
    assert payload.id_max_mm == 78.0


def test_conflicting_dual_write_rejected():
    with pytest.raises(HTTPException) as exc:
        reject_conflicting_final_writes({"id_min_mm": 76.0}, {"id_min_mm": 80.0})
    assert exc.value.status_code == 409
    assert exc.value.detail["code"] == "CONFLICTING_FINAL_LIMITS"


def test_qc_final_block_requires_spec_command():
    spec = SimpleNamespace(id_min_mm=76.0, id_max_mm=78.0)
    with pytest.raises(HTTPException) as exc:
        reject_qc_contractual_final({"final": {"id": {"min": 76.0, "max": 78.0}}}, spec)
    assert exc.value.detail["code"] == "CONTRACTUAL_FINAL_REQUIRES_SPEC_COMMAND"


def test_projection_is_canonical_source():
    block = project_final_block({"id_min_mm": 76.2, "id_max_mm": 78.0})
    assert block["id"]["min"] == 76.2
    assert block["id"]["source"] == "canonical"
    assert extract_final_from_profile({"final": block})["id_min_mm"] == 76.2
