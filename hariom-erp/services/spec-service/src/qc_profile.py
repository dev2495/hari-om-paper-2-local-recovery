"""Spec-owned QC profile persistence helpers.

Stage parameter names are the client's exact winding/oven/process fields.
Approved numeric ranges are stored as submitted; this module never invents
thresholds, copies final-to-winding limits, or fills missing bounds with zero.
"""

from __future__ import annotations

from typing import Any, Optional


class QcProfileError(ValueError):
    def __init__(self, message: str, *, code: str = "INVALID_PROFILE"):
        super().__init__(message)
        self.code = code
        self.message = message


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


def _require_bound(value: Any, *, field: str, code: str) -> Optional[float]:
    if value in (None, ""):
        return None
    number = _finite_or_none(value)
    if number is None:
        raise QcProfileError(
            f"Malformed numeric {field} for {code}.",
            code="MALFORMED_BOUNDS",
        )
    return number


_UNSAFE_RULE_KEYS = {
    "formula",
    "expression",
    "eval",
    "script",
    "code_expr",
    "derived_expr",
    "python",
    "javascript",
}


def _reject_unsafe_rule_payload(raw: dict[str, Any], *, code: str) -> None:
    lowered = {str(key).strip().lower() for key in raw.keys()}
    hit = sorted(lowered & _UNSAFE_RULE_KEYS)
    if hit:
        raise QcProfileError(
            f"Unsafe rule expression for {code} is rejected ({', '.join(hit)}). Only allowlisted bound/option fields are accepted.",
            code="UNSAFE_RULE",
        )
    for key in ("formula", "expression", "eval", "script"):
        nested = raw.get("rule") if isinstance(raw.get("rule"), dict) else None
        if nested and nested.get(key):
            raise QcProfileError(
                f"Unsafe nested rule expression for {code} is rejected.",
                code="UNSAFE_RULE",
            )


def _normalize_parameter(raw: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    _reject_unsafe_rule_payload(raw, code=fallback["code"])
    lower = _require_bound(raw.get("min") if "min" in raw else raw.get("lower"), field="min", code=fallback["code"])
    upper = _require_bound(raw.get("max") if "max" in raw else raw.get("upper"), field="max", code=fallback["code"])
    if lower is not None and upper is not None and lower > upper:
        raise QcProfileError(
            f"Inverted bounds for {fallback['code']}: min {lower} > max {upper}.",
            code="INVERTED_BOUNDS",
        )
    applicable = raw.get("applicable")
    if applicable is None:
        applicable = fallback.get("conditional") is None
    required = raw.get("required")
    if required is None:
        required = True
    input_type = str(raw.get("input_type") or "number").strip().lower() or "number"
    options = raw.get("options") if isinstance(raw.get("options"), list) else None
    if input_type in {"select", "categorical", "enum", "boolean"}:
        cleaned = [item for item in (options or []) if str(item).strip() != ""]
        if not cleaned:
            raise QcProfileError(
                f"Empty categorical accept-set for {fallback['code']} cannot be approved or evaluated.",
                code="EMPTY_ACCEPT_SET",
            )
        options = cleaned
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
        "input_type": input_type,
        "options": options,
        "checkpoint": _clean_text(raw.get("checkpoint")) or (
            "PRE" if fallback["code"].startswith("pre_") else "POST" if fallback["code"].startswith("post_") else None
        ),
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
    if explicit in {"pending_review", "draft", "incomplete", "missing"}:
        if explicit == "pending_review":
            return "pending_review"
        if explicit == "draft":
            pass
        elif explicit in {"incomplete", "missing"}:
            return explicit
    if explicit == "approved" and profile.get("approved_by"):
        return "approved"
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


def normalize_qc_profile(
    raw: Any,
    *,
    previous: Optional[dict[str, Any]] = None,
    mutating: bool = False,
    allow_approved: bool = False,
) -> dict[str, Any]:
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
    previous_revision = previous.get("revision") or 1
    try:
        previous_revision = int(previous_revision)
    except (TypeError, ValueError):
        previous_revision = 1
    previous_status = str(previous.get("status") or "").strip().lower()
    requested = incoming.get("status")
    if mutating and requested == "approved" and not allow_approved:
        requested = None
    if mutating:
        revision = previous_revision
        if previous_status == "approved" and not allow_approved:
            revision = previous_revision + 1
            incoming_snapshot = previous.get("approved_snapshot") or {
                key: value for key, value in previous.items() if key != "approved_snapshot"
            }
        else:
            incoming_snapshot = previous.get("approved_snapshot")
    else:
        try:
            revision = int(incoming.get("revision") or previous_revision)
        except (TypeError, ValueError):
            revision = previous_revision
        incoming_snapshot = incoming.get("approved_snapshot") or previous.get("approved_snapshot")
    normalized = {
        "status": requested or previous.get("status") or "draft",
        "revision": revision,
        "stages": merged_stages,
        "method_notes": _clean_text(incoming.get("method_notes") or previous.get("method_notes")),
        "notching_applicable": incoming.get("notching_applicable")
        if "notching_applicable" in incoming
        else previous.get("notching_applicable"),
    }
    if incoming_snapshot:
        normalized["approved_snapshot"] = incoming_snapshot
        if previous.get("approved_by"):
            normalized["approved_by"] = previous.get("approved_by")
        if previous.get("approved_at"):
            normalized["approved_at"] = previous.get("approved_at")
    if mutating and previous_status == "approved" and not allow_approved:
        normalized["status"] = requested if requested in {"draft", "pending_review", "complete"} else "draft"
        normalized["supersedes_revision"] = previous_revision
    elif requested in {"pending_review", "draft", "complete"}:
        normalized["status"] = requested
    elif requested == "approved" and allow_approved:
        normalized["status"] = "approved"
    else:
        normalized["status"] = profile_status(normalized)
    return normalized
