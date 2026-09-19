"""Spec-owned QC profile persistence helpers.

Stage parameter names are the client's exact winding/oven/process fields.
Approved numeric ranges are stored as submitted; this module never invents
thresholds, copies final-to-winding limits, or fills missing bounds with zero.
"""

from __future__ import annotations

import copy
from typing import Any, Optional


class QcProfileError(ValueError):
    def __init__(self, message: str, *, code: str = "INVALID_PROFILE"):
        super().__init__(message)
        self.code = code
        self.message = message


NOTCH_CODES = {"notch_distance", "notch_depth"}
NOTCH_SPEC_KEYS = (
    "notch_type",
    "notch_distance_mm",
    "notch_depth_mm",
    "notching_holder",
    "notching_blade",
    "v_flat",
    "punch",
)
NOT_APPLICABLE_LABEL = "NOT APPLICABLE"
GATING_ADVISORY = "advisory"
GATING_BLOCKING = "blocking"
_ADVISORY_TOKENS = {"advisory", "nonblocking", "non_blocking", "informational", "info", "watch"}
_BLOCKING_TOKENS = {"blocking", "mandatory", "required", "block", "gate"}

STAGE_PARAMETER_DEFS: dict[str, tuple[dict[str, Any], ...]] = {
    "WINDER": (
        {"code": "id", "label": "I.D.", "unit": "mm", "basis_hint": "Winding I.D."},
        {"code": "od", "label": "O.D.", "unit": "mm", "basis_hint": "Winding O.D."},
        {"code": "height", "label": "Height", "unit": "mm", "basis_hint": "Height at winding"},
        {"code": "weight", "label": "Weight", "unit": "g", "basis_hint": "Winding specimen"},
        {"code": "cs", "label": "C.S.", "unit": "N", "basis_hint": "Winding C.S."},
    ),
    "OVEN": (
        {"code": "pre_weight", "label": "Pre-weight", "unit": "g", "pair_group": "oven_sample", "basis_hint": "Oven pre-weight specimen"},
        {"code": "post_weight", "label": "Post-weight", "unit": "g", "pair_group": "oven_sample", "basis_hint": "Oven post-weight specimen"},
        {"code": "pre_moisture", "label": "Pre-moisture", "unit": "%", "pair_group": "oven_sample", "basis_hint": "Oven pre-moisture specimen"},
        {"code": "post_moisture", "label": "Post-moisture", "unit": "%", "pair_group": "oven_sample", "basis_hint": "Oven post-moisture specimen"},
    ),
    "PROCESS": (
        {"code": "height", "label": "Height", "unit": "mm", "basis_hint": "Finished height"},
        {"code": "weight", "label": "Weight", "unit": "g", "basis_hint": "Finished specimen"},
        {"code": "cs", "label": "C.S.", "unit": "N", "basis_hint": "Finished C.S."},
        {"code": "notch_distance", "label": "Notch distance", "unit": "mm", "conditional": "notching", "basis_hint": "Process notch distance"},
        {"code": "notch_depth", "label": "Notch depth", "unit": "mm", "conditional": "notching", "basis_hint": "Process notch depth"},
        {"code": "moisture", "label": "Moisture", "unit": "%", "basis_hint": "Finished moisture"},
    ),
}

EXACT_STAGE_LABELS = {
    stage: tuple(item["label"] for item in rows) for stage, rows in STAGE_PARAMETER_DEFS.items()
}
GENERIC_FORBIDDEN_LABELS = {
    "Inner Diameter",
    "Inner diameter",
    "ID",
    "Length",
    "Outer Diameter",
    "Outer diameter",
    "OD",
    "CS",
    "Crush Strength",
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


def _tri_state(value: Any) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"", "unknown", "null", "none"}:
            return None
        if text in {"true", "1", "yes"}:
            return True
        if text in {"false", "0", "no"}:
            return False
    return bool(value)


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


def _has_explicit_gating(raw: Any) -> bool:
    if isinstance(raw, str):
        return bool(raw.strip())
    if not isinstance(raw, dict):
        return False
    for key in ("gating", "gate", "checkpoint_gating", "advisory", "blocking"):
        if key in raw and raw.get(key) not in (None, ""):
            return True
    return False


def _normalize_gating(raw: Any) -> Optional[str]:
    """Persist explicit approved gating only. Omission stays unspecified so evaluator defaults to blocking."""
    if not _has_explicit_gating(raw):
        return None
    blob = raw if isinstance(raw, dict) else {"gating": raw}
    for key in ("gating", "gate", "checkpoint_gating"):
        token = str(blob.get(key) or "").strip().lower()
        if token in _ADVISORY_TOKENS:
            return GATING_ADVISORY
        if token in _BLOCKING_TOKENS:
            return GATING_BLOCKING
    if "advisory" in blob and blob.get("advisory") not in (None, ""):
        return GATING_ADVISORY if bool(blob.get("advisory")) else GATING_BLOCKING
    if "blocking" in blob and blob.get("blocking") not in (None, ""):
        return GATING_BLOCKING if bool(blob.get("blocking")) else GATING_ADVISORY
    return None


def _normalize_parameter(
    raw: dict[str, Any],
    fallback: dict[str, Any],
    *,
    notching_applicable: Optional[bool] = None,
) -> dict[str, Any]:
    _reject_unsafe_rule_payload(raw, code=fallback["code"])
    applicable = _tri_state(raw.get("applicable")) if "applicable" in raw else None
    if fallback.get("conditional") == "notching":
        if notching_applicable is False:
            applicable = False
        elif notching_applicable is True and applicable is None:
            applicable = True
    elif applicable is None:
        applicable = True

    if applicable is False:
        lower = None
        upper = None
    else:
        lower = _require_bound(raw.get("min") if "min" in raw else raw.get("lower"), field="min", code=fallback["code"])
        upper = _require_bound(raw.get("max") if "max" in raw else raw.get("upper"), field="max", code=fallback["code"])
        if lower is not None and upper is not None and lower > upper:
            raise QcProfileError(
                f"Inverted bounds for {fallback['code']}: min {lower} > max {upper}.",
                code="INVERTED_BOUNDS",
            )

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
    payload = {
        "code": fallback["code"],
        "label": fallback["label"],
        "unit": _clean_text(raw.get("unit")) or fallback["unit"],
        "method": _clean_text(raw.get("method")),
        "specimen": _clean_text(raw.get("specimen") or raw.get("basis")),
        "sampling": _clean_text(raw.get("sampling")),
        "basis_hint": fallback.get("basis_hint"),
        "min": lower,
        "max": upper,
        "inclusive_min": bool(raw.get("inclusive_min", True)),
        "inclusive_max": bool(raw.get("inclusive_max", True)),
        "required": bool(required),
        "applicable": applicable,
        "pair_group": fallback.get("pair_group"),
        "conditional": fallback.get("conditional"),
        "input_type": input_type,
        "options": options,
        "checkpoint": _clean_text(raw.get("checkpoint")) or (
            "PRE" if fallback["code"].startswith("pre_") else "POST" if fallback["code"].startswith("post_") else None
        ),
        "requires_instrument": bool(
            raw.get("requires_instrument") is True
            or raw.get("instrument_required") is True
            or str(raw.get("requires_instrument") or "").strip().lower() in {"1", "true", "yes", "required", "calibrated"}
            or str(raw.get("instrument_required") or "").strip().lower() in {"1", "true", "yes", "required", "calibrated"}
        ),
        "required_instrument_id": _clean_text(raw.get("required_instrument_id"))
        or (
            _clean_text(raw.get("instrument_id"))
            if bool(
                raw.get("requires_instrument") is True
                or raw.get("instrument_required") is True
                or str(raw.get("requires_instrument") or "").strip().lower() in {"1", "true", "yes", "required", "calibrated"}
                or str(raw.get("instrument_required") or "").strip().lower() in {"1", "true", "yes", "required", "calibrated"}
            )
            else None
        ),
    }
    gating = _normalize_gating(raw)
    if gating is not None:
        payload["gating"] = gating
    return payload


def _stage_complete(parameters: list[dict[str, Any]]) -> bool:
    for row in parameters:
        if row.get("applicable") is False:
            continue
        if row.get("applicable") is None and row.get("conditional") == "notching":
            return False
        if not row.get("required"):
            continue
        if row.get("min") is None and row.get("max") is None:
            return False
        if not row.get("unit"):
            return False
    return True


def _has_assigned_stage_rows(profile: dict[str, Any]) -> bool:
    stages = profile.get("stages") if isinstance(profile.get("stages"), dict) else {}
    for stage_key in STAGE_PARAMETER_DEFS:
        block = stages.get(stage_key) if isinstance(stages.get(stage_key), dict) else {}
        parameters = block.get("parameters") if isinstance(block.get("parameters"), list) else []
        if any(isinstance(row, dict) and row.get("code") for row in parameters):
            return True
    return False


def _notch_rows(profile: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(profile, dict):
        return []
    stages = profile.get("stages") if isinstance(profile.get("stages"), dict) else {}
    process = stages.get("PROCESS") if isinstance(stages.get("PROCESS"), dict) else {}
    parameters = process.get("parameters") if isinstance(process.get("parameters"), list) else []
    return [
        row
        for row in parameters
        if isinstance(row, dict) and str(row.get("code") or "") in NOTCH_CODES
    ]


def _dynamic_map_from_spec(spec: Any, dynamic_map: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    values = dict(dynamic_map or {})
    if spec is None:
        return values
    if isinstance(spec, dict):
        for key, value in spec.items():
            if key not in values:
                values[key] = value
        return values
    for value in getattr(spec, "dynamic_values", None) or []:
        field = getattr(value, "field", None)
        key = getattr(field, "key", None)
        if key and key not in values:
            values[str(key)] = getattr(value, "value", None)
    return values


def spec_notching_evidence(spec: Any = None, dynamic_map: Optional[dict[str, Any]] = None) -> Optional[bool]:
    """True when the spec carries notching tools/values. Empty fields stay unknown, never auto-false."""
    values = _dynamic_map_from_spec(spec, dynamic_map)
    profile = values.get("profile") if isinstance(values.get("profile"), dict) else {}
    notch_tooling = profile.get("notch_tooling") if isinstance(profile.get("notch_tooling"), dict) else {}
    diagram = notch_tooling.get("diagram") if isinstance(notch_tooling.get("diagram"), dict) else {}
    for key in NOTCH_SPEC_KEYS:
        raw = values.get(key)
        if raw in (None, "", False, "false", "0", "n", "no"):
            raw = notch_tooling.get(key)
        if raw in (None, "", False, "false", "0", "n", "no"):
            raw = diagram.get(key)
        if raw in (None, "", False, "false", "0", "n", "no"):
            continue
        return True
    return None


def notching_review_required(
    profile: Optional[dict[str, Any]],
    spec: Any = None,
    *,
    dynamic_map: Optional[dict[str, Any]] = None,
) -> bool:
    if not isinstance(profile, dict):
        return False
    stages = profile.get("stages") if isinstance(profile.get("stages"), dict) else {}
    if "PROCESS" not in stages and "WINDER" not in stages and "OVEN" not in stages:
        return False
    flag = _tri_state(profile.get("notching_applicable")) if "notching_applicable" in profile else None
    rows = _notch_rows(profile)
    decided_false = bool(rows) and all(row.get("applicable") is False for row in rows)
    decided_true = bool(rows) and all(row.get("applicable") is True for row in rows)
    evidence = spec_notching_evidence(spec, dynamic_map)
    if evidence is True and flag is False:
        return True
    if evidence is True and decided_false and not decided_true:
        return True
    if flag is None and not decided_false and not decided_true:
        return True
    return False


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
    if notching_review_required(profile):
        all_complete = False
    if not any_bounds:
        if explicit == "draft" and _has_assigned_stage_rows(profile):
            return "draft"
        return "missing"
    if all_complete:
        return "complete" if explicit != "draft" else "draft"
    return "draft"


def empty_qc_profile() -> dict[str, Any]:
    stages: dict[str, Any] = {}
    for stage, defs in STAGE_PARAMETER_DEFS.items():
        stages[stage] = {
            "parameters": [_normalize_parameter({}, dict(item), notching_applicable=None) for item in defs],
        }
    return {
        "status": "missing",
        "revision": 1,
        "notching_applicable": None,
        "stages": stages,
    }


def _infer_notching_flag(merged_stages: dict[str, Any], requested: Optional[bool]) -> Optional[bool]:
    if requested is not None:
        return requested
    process = merged_stages.get("PROCESS") if isinstance(merged_stages.get("PROCESS"), dict) else {}
    parameters = process.get("parameters") if isinstance(process.get("parameters"), list) else []
    notch_rows = [
        row for row in parameters if isinstance(row, dict) and str(row.get("code") or "") in NOTCH_CODES
    ]
    if notch_rows and all(row.get("applicable") is False for row in notch_rows):
        return False
    if notch_rows and all(row.get("applicable") is True for row in notch_rows):
        return True
    return None


def normalize_qc_profile(
    raw: Any,
    *,
    previous: Optional[dict[str, Any]] = None,
    mutating: bool = False,
    allow_approved: bool = False,
) -> dict[str, Any]:
    incoming = raw if isinstance(raw, dict) else {}
    previous = previous if isinstance(previous, dict) else {}
    previous_stages = previous.get("stages") if isinstance(previous.get("stages"), dict) else {}
    incoming_stages = incoming.get("stages") if isinstance(incoming.get("stages"), dict) else incoming
    if "notching_applicable" in incoming:
        notching_flag = _tri_state(incoming.get("notching_applicable"))
    elif "notching_applicable" in previous:
        notching_flag = _tri_state(previous.get("notching_applicable"))
    else:
        notching_flag = None
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
                _normalize_parameter(
                    by_code.get(item["code"], {}),
                    dict(item),
                    notching_applicable=notching_flag,
                )
                for item in defs
            ]
        }
        source_gating = _normalize_gating(source_block if isinstance(source_block, dict) else {})
        if source_gating is not None:
            merged_stages[stage]["gating"] = source_gating
    notching_flag = _infer_notching_flag(merged_stages, notching_flag)
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
        "notching_applicable": notching_flag,
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


def project_qc_read_contract(
    profile: Any,
    spec: Any = None,
    *,
    dynamic_map: Optional[dict[str, Any]] = None,
) -> Any:
    """GET projection: exact client names, NOT APPLICABLE display, no zero substitutes."""
    if not isinstance(profile, dict):
        return profile
    copied = copy.deepcopy(profile)
    stages = copied.get("stages") if isinstance(copied.get("stages"), dict) else {}
    for stage, defs in STAGE_PARAMETER_DEFS.items():
        block = stages.get(stage)
        if not isinstance(block, dict):
            continue
        parameters = block.get("parameters")
        if not isinstance(parameters, list):
            continue
        by_code = {item["code"]: item for item in defs}
        projected: list[dict[str, Any]] = []
        for row in parameters:
            if not isinstance(row, dict):
                continue
            item = dict(row)
            fallback = by_code.get(str(item.get("code") or ""))
            if fallback:
                item["label"] = fallback["label"]
                item["basis_hint"] = fallback.get("basis_hint")
                if fallback.get("conditional") == "notching" and item.get("applicable") is False:
                    item["applicability_label"] = NOT_APPLICABLE_LABEL
                    item["display_rule"] = NOT_APPLICABLE_LABEL
                    item["min"] = None
                    item["max"] = None
            projected.append(item)
        block["parameters"] = projected
    copied["notching_review_required"] = notching_review_required(copied, spec, dynamic_map=dynamic_map)
    return copied


def winding_parameter(profile: Any, code: str) -> Optional[dict[str, Any]]:
    if not isinstance(profile, dict):
        return None
    stages = profile.get("stages") if isinstance(profile.get("stages"), dict) else {}
    winder = stages.get("WINDER") if isinstance(stages.get("WINDER"), dict) else {}
    parameters = winder.get("parameters") if isinstance(winder.get("parameters"), list) else []
    for row in parameters:
        if isinstance(row, dict) and row.get("code") == code:
            return row
    return None
