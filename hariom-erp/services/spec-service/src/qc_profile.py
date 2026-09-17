"""Spec-owned QC profile persistence helpers.

Stage parameter names are the client's exact winding/oven/process fields.
Approved numeric ranges are stored as submitted; this module never invents
thresholds, copies final-to-winding limits, or fills missing bounds with zero.
"""

from __future__ import annotations

from typing import Any, Optional


STAGE_PARAMETER_DEFS: dict[str, tuple[dict[str, Any], ...]] = {
    "WINDER": (
        {"code": "id", "label": "I.D.", "unit": "mm"},
        {"code": "od", "label": "O.D.", "unit": "mm"},
        {"code": "height", "label": "Height", "unit": "mm"},
        {"code": "weight", "label": "Weight", "unit": "g"},
        {"code": "cs", "label": "C.S.", "unit": "N"},
    ),
    "OVEN": (
        {"code": "pre_weight", "label": "Pre-weight", "unit": "g", "pair_group": "oven_sample"},
        {"code": "post_weight", "label": "Post-weight", "unit": "g", "pair_group": "oven_sample"},
        {"code": "pre_moisture", "label": "Pre-moisture", "unit": "%", "pair_group": "oven_sample"},
        {"code": "post_moisture", "label": "Post-moisture", "unit": "%", "pair_group": "oven_sample"},
    ),
    "PROCESS": (
        {"code": "height", "label": "Height", "unit": "mm"},
        {"code": "weight", "label": "Weight", "unit": "g"},
        {"code": "cs", "label": "C.S.", "unit": "N"},
        {"code": "notch_distance", "label": "Notch distance", "unit": "mm", "conditional": "notching"},
        {"code": "notch_depth", "label": "Notch depth", "unit": "mm", "conditional": "notching"},
        {"code": "moisture", "label": "Moisture", "unit": "%"},
    ),
}


def _clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _finite_or_none(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return number


def _normalize_parameter(raw: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    lower = _finite_or_none(raw.get("min") if "min" in raw else raw.get("lower"))
    upper = _finite_or_none(raw.get("max") if "max" in raw else raw.get("upper"))
    applicable = raw.get("applicable")
    if applicable is None:
        applicable = fallback.get("conditional") is None
    required = raw.get("required")
    if required is None:
        required = True
    return {
        "code": fallback["code"],
        "label": _clean_text(raw.get("label")) or fallback["label"],
        "unit": _clean_text(raw.get("unit")) or fallback["unit"],
        "method": _clean_text(raw.get("method")),
        "specimen": _clean_text(raw.get("specimen") or raw.get("basis")),
        "sampling": _clean_text(raw.get("sampling")),
        "min": lower,
        "max": upper,
        "inclusive_min": bool(raw.get("inclusive_min", True)),
        "inclusive_max": bool(raw.get("inclusive_max", True)),
        "required": bool(required),
        "applicable": bool(applicable),
        "pair_group": fallback.get("pair_group"),
        "conditional": fallback.get("conditional"),
        "input_type": "number",
    }


def _stage_complete(parameters: list[dict[str, Any]]) -> bool:
    for row in parameters:
        if not row.get("applicable"):
            continue
        if not row.get("required"):
            continue
        if row.get("min") is None and row.get("max") is None:
            return False
        if not row.get("unit"):
            return False
    return True


def profile_status(profile: Optional[dict[str, Any]]) -> str:
    if not isinstance(profile, dict) or not profile:
        return "missing"
    explicit = _clean_text(profile.get("status"))
    if explicit in {"approved", "pending_review", "draft", "incomplete", "missing"}:
        if explicit == "approved":
            return "approved"
        if explicit == "pending_review":
            return "pending_review"
    stages = profile.get("stages") if isinstance(profile.get("stages"), dict) else {}
    if not stages:
        return "missing"
    any_bounds = False
    all_complete = True
    for stage_key in STAGE_PARAMETER_DEFS:
        block = stages.get(stage_key) if isinstance(stages.get(stage_key), dict) else {}
        parameters = block.get("parameters") if isinstance(block.get("parameters"), list) else []
        if not parameters:
            all_complete = False
            continue
        if any(row.get("min") is not None or row.get("max") is not None for row in parameters if isinstance(row, dict)):
            any_bounds = True
        if not _stage_complete([row for row in parameters if isinstance(row, dict)]):
            all_complete = False
    if not any_bounds:
        return "missing"
    if all_complete:
        return "complete" if explicit != "draft" else "draft"
    return "draft"


def empty_qc_profile() -> dict[str, Any]:
    stages: dict[str, Any] = {}
    for stage, defs in STAGE_PARAMETER_DEFS.items():
        stages[stage] = {
            "parameters": [_normalize_parameter({}, dict(item)) for item in defs],
        }
    return {
        "status": "missing",
        "revision": 1,
        "stages": stages,
    }


def normalize_qc_profile(raw: Any, *, previous: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    base = empty_qc_profile()
    incoming = raw if isinstance(raw, dict) else {}
    previous = previous if isinstance(previous, dict) else {}
    previous_stages = previous.get("stages") if isinstance(previous.get("stages"), dict) else {}
    incoming_stages = incoming.get("stages") if isinstance(incoming.get("stages"), dict) else incoming
    merged_stages: dict[str, Any] = {}
    for stage, defs in STAGE_PARAMETER_DEFS.items():
        incoming_block = incoming_stages.get(stage) if isinstance(incoming_stages, dict) else None
        if incoming_block is None and isinstance(incoming_stages, dict):
            incoming_block = incoming_stages.get(stage.lower())
        previous_block = previous_stages.get(stage) if isinstance(previous_stages, dict) else {}
        incoming_params = []
        source_block = incoming_block if isinstance(incoming_block, dict) else previous_block
        if isinstance(source_block, dict):
            incoming_params = source_block.get("parameters") or source_block.get("metrics") or []
        by_code: dict[str, dict[str, Any]] = {}
        if isinstance(incoming_params, list):
            for row in incoming_params:
                if isinstance(row, dict) and row.get("code"):
                    by_code[str(row.get("code"))] = row
        merged_stages[stage] = {
            "parameters": [
                _normalize_parameter(by_code.get(item["code"], {}), dict(item))
                for item in defs
            ]
        }
    revision = incoming.get("revision") or previous.get("revision") or 1
    try:
        revision = int(revision)
    except (TypeError, ValueError):
        revision = 1
    normalized = {
        "status": "draft",
        "revision": revision,
        "stages": merged_stages,
        "method_notes": _clean_text(incoming.get("method_notes") or previous.get("method_notes")),
        "notching_applicable": incoming.get("notching_applicable")
        if "notching_applicable" in incoming
        else previous.get("notching_applicable"),
    }
    normalized["status"] = profile_status(normalized) if incoming.get("status") not in {"approved", "pending_review"} else incoming.get("status")
    if incoming.get("status") == "draft":
        normalized["status"] = "draft"
    return normalized
