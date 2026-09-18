"""Canonical typed QC evaluator for production and inventory services.

This is the single shared implementation. Service-local ``quality_eval.py``
files are import shims so ``from src.quality_eval import ...`` keeps working.

Binding invariants:
- Verdicts are computed here, never trusted from a client.
- No invented thresholds, default zeros, uniform +/- percent, or copied
  final-to-winding limits. Missing approved bounds cannot produce PASS.
- A linked reason never creates PASS. FAIL stays FAIL.
- Blank / non-numeric readings are INCOMPLETE / INVALID, never PASS.

Compatibility APIs retained from the p0 correctness slice:
- ``evaluate_stage_quality`` — four-way typed validator against spec-snapshot
  bounds (INCOMPLETE / INVALID / PASS / FAIL).
- ``evaluate_incoming_quality`` — incoming-QC verdict from frozen inventory
  templates, ignoring client-authored status.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from math import isfinite
from typing import Any, Iterable, Optional


STAGE_WINDER = "WINDER"
STAGE_OVEN = "OVEN"
STAGE_PROCESS = "PROCESS"
STAGE_QC = "QC"
STAGE_PACKING = "PACKING"
STAGE_INWARD = "INWARD"

VERDICT_PASS = "PASS"
VERDICT_FAIL = "FAIL"
VERDICT_INCOMPLETE = "INCOMPLETE"
VERDICT_INVALID = "INVALID"
VERDICT_NOT_APPLICABLE = "NOT_APPLICABLE"
VERDICT_NOT_REQUIRED = "NOT_REQUIRED"
VERDICT_OBSERVATION = "OBSERVATION_ONLY"

_VERDICT_RANK = {
    VERDICT_FAIL: 50,
    VERDICT_INVALID: 40,
    VERDICT_INCOMPLETE: 30,
    VERDICT_OBSERVATION: 20,
    VERDICT_NOT_REQUIRED: 15,
    VERDICT_NOT_APPLICABLE: 10,
    VERDICT_PASS: 0,
}

READING_ALIASES: dict[str, tuple[str, ...]] = {
    "id": ("id", "ID", "i.d.", "inner_diameter"),
    "od": ("od", "OD", "o.d.", "outer_diameter"),
    "height": ("height", "Height", "HEIGHT"),
    "weight": ("weight", "Weight"),
    "cs": ("cs", "CS", "c.s.", "crush_strength"),
    "pre_weight": ("pre_weight", "pre-weight"),
    "post_weight": ("post_weight", "post-weight"),
    "pre_moisture": ("pre_moisture", "pre-moisture", "moisture_before"),
    "post_moisture": ("post_moisture", "post-moisture", "moisture_after"),
    "notch_distance": ("notch_distance", "notch_distance_mm"),
    "notch_depth": ("notch_depth", "notch_depth_mm"),
    "moisture": ("moisture", "moisture_pct", "moisture_after"),
}


@dataclass(frozen=True)
class ParameterDef:
    code: str
    label: str
    default_unit: str
    pair_group: Optional[str] = None
    conditional: Optional[str] = None


STAGE_PARAMETER_DEFS: dict[str, tuple[ParameterDef, ...]] = {
    STAGE_WINDER: (
        ParameterDef("id", "I.D.", "mm"),
        ParameterDef("od", "O.D.", "mm"),
        ParameterDef("height", "Height", "mm"),
        ParameterDef("weight", "Weight", "g"),
        ParameterDef("cs", "C.S.", "N"),
    ),
    STAGE_OVEN: (
        ParameterDef("pre_weight", "Pre-weight", "g", pair_group="oven_sample"),
        ParameterDef("post_weight", "Post-weight", "g", pair_group="oven_sample"),
        ParameterDef("pre_moisture", "Pre-moisture", "%", pair_group="oven_sample"),
        ParameterDef("post_moisture", "Post-moisture", "%", pair_group="oven_sample"),
    ),
    STAGE_PROCESS: (
        ParameterDef("height", "Height", "mm"),
        ParameterDef("weight", "Weight", "g"),
        ParameterDef("cs", "C.S.", "N"),
        ParameterDef("notch_distance", "Notch distance", "mm", conditional="notching"),
        ParameterDef("notch_depth", "Notch depth", "mm", conditional="notching"),
        ParameterDef("moisture", "Moisture", "%"),
    ),
}


@dataclass
class ParameterRule:
    code: str
    label: str
    unit: str
    method: Optional[str] = None
    specimen: Optional[str] = None
    sampling: Optional[str] = None
    lower: Optional[Decimal] = None
    upper: Optional[Decimal] = None
    inclusive_min: bool = True
    inclusive_max: bool = True
    required: bool = True
    applicable: bool = True
    pair_group: Optional[str] = None
    input_type: str = "number"
    options: Optional[list[Any]] = None

    def allowed_display(self) -> str:
        if not self.applicable:
            return "Not applicable"
        if self.lower is None and self.upper is None:
            return f"Allowed: not configured {self.unit}".strip()
        if self.lower is not None and self.upper is not None:
            return f"Allowed: {_format_bound(self.lower)}–{_format_bound(self.upper)} {self.unit}".strip()
        if self.lower is not None:
            op = "≥" if self.inclusive_min else ">"
            return f"Allowed: {op} {_format_bound(self.lower)} {self.unit}".strip()
        op = "≤" if self.inclusive_max else "<"
        return f"Allowed: {op} {_format_bound(self.upper)} {self.unit}".strip()

    def has_numeric_rule(self) -> bool:
        return self.lower is not None or self.upper is not None

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "label": self.label,
            "unit": self.unit,
            "method": self.method,
            "specimen": self.specimen,
            "sampling": self.sampling,
            "min": _decimal_to_number(self.lower),
            "max": _decimal_to_number(self.upper),
            "inclusive_min": self.inclusive_min,
            "inclusive_max": self.inclusive_max,
            "required": self.required,
            "applicable": self.applicable,
            "pair_group": self.pair_group,
            "input_type": self.input_type,
            "options": list(self.options or []),
            "allowed_display": self.allowed_display(),
        }


@dataclass
class ParameterResult:
    code: str
    label: str
    verdict: str
    submitted: Any = None
    numeric_value: Optional[float] = None
    rule: Optional[ParameterRule] = None
    message: str = ""
    reason: Optional[dict[str, Any]] = None

    def as_dict(self) -> dict[str, Any]:
        payload = {
            "code": self.code,
            "label": self.label,
            "verdict": self.verdict,
            "submitted": self.submitted,
            "value": self.numeric_value,
            "message": self.message,
            "allowed_display": self.rule.allowed_display() if self.rule else None,
            "reason": self.reason,
        }
        if self.rule:
            payload["min"] = _decimal_to_number(self.rule.lower)
            payload["max"] = _decimal_to_number(self.rule.upper)
            payload["unit"] = self.rule.unit
        return payload


@dataclass
class InspectionEvaluation:
    verdict: str
    parameter_results: list[ParameterResult] = field(default_factory=list)
    failures: list[dict[str, Any]] = field(default_factory=list)
    missing_reasons: list[str] = field(default_factory=list)
    frozen_rules: list[dict[str, Any]] = field(default_factory=list)
    sample_id: Optional[str] = None
    profile_revision: Optional[int] = None
    evaluator_version: str = "qc-eval/1"

    @property
    def status(self) -> str:
        """Alias used by p0 typed-validator callers (``evaluation.status``)."""
        return self.verdict

    def issue_summary(self) -> str:
        parts: list[str] = []
        for item in self.failures:
            parts.append(str(item.get("message") or item.get("label") or "out of range"))
        for row in self.parameter_results:
            if row.verdict in {VERDICT_INVALID, VERDICT_INCOMPLETE} and row.message:
                parts.append(f"{row.label} {row.verdict.lower()} ({row.message})")
        return "; ".join(parts)

    def as_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "status": self.verdict,
            "parameter_results": [row.as_dict() for row in self.parameter_results],
            "failures": self.failures,
            "missing_reasons": self.missing_reasons,
            "frozen_rules": self.frozen_rules,
            "sample_id": self.sample_id,
            "profile_revision": self.profile_revision,
            "evaluator_version": self.evaluator_version,
            "issue_summary": self.issue_summary(),
        }


def _format_bound(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def _decimal_to_number(value: Optional[Decimal]) -> Optional[float]:
    if value is None:
        return None
    return float(value)


def parse_finite_number(value: Any) -> tuple[Optional[Decimal], Optional[str]]:
    """Return (number, error_kind) where error_kind is blank|invalid|None."""
    if value is None:
        return None, "blank"
    if isinstance(value, bool):
        return None, "invalid"
    if isinstance(value, str):
        text = value.strip()
        if text == "":
            return None, "blank"
        if text.lower() in {"nan", "inf", "+inf", "-inf", "infinity", "+infinity", "-infinity"}:
            return None, "invalid"
        try:
            number = Decimal(text)
        except (InvalidOperation, ValueError):
            return None, "invalid"
        if not number.is_finite():
            return None, "invalid"
        return number, None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not isfinite(value):
            return None, "invalid"
        try:
            number = Decimal(str(value))
        except (InvalidOperation, ValueError):
            return None, "invalid"
        if not number.is_finite():
            return None, "invalid"
        return number, None
    return None, "invalid"


def _reading_for(readings: dict[str, Any], code: str) -> Any:
    if not isinstance(readings, dict):
        return None
    if code in readings:
        return readings.get(code)
    for alias in READING_ALIASES.get(code, (code,)):
        if alias in readings:
            return readings.get(alias)
    lowered = {str(key).strip().lower(): key for key in readings.keys()}
    match = lowered.get(str(code).strip().lower())
    if match is not None:
        return readings.get(match)
    return None


def _reason_for(reasons: Any, code: str) -> Optional[dict[str, Any]]:
    if reasons is None:
        return None
    if isinstance(reasons, dict):
        raw = reasons.get(code)
        if raw is None:
            return None
        if isinstance(raw, dict):
            text = str(raw.get("explanation") or raw.get("reason") or raw.get("text") or "").strip()
            code_value = str(raw.get("code") or raw.get("reason_code") or "").strip()
            if not text and not code_value:
                return None
            return {"code": code_value or None, "explanation": text or None}
        text = str(raw).strip()
        return {"code": None, "explanation": text} if text else None
    if isinstance(reasons, list):
        for item in reasons:
            if not isinstance(item, dict):
                continue
            item_code = str(item.get("parameter") or item.get("code") or item.get("parameter_code") or "").strip()
            if item_code != code:
                continue
            text = str(item.get("explanation") or item.get("reason") or item.get("text") or "").strip()
            code_value = str(item.get("reason_code") or item.get("code") or "").strip()
            if item_code == code and (text or code_value):
                return {"code": code_value or None, "explanation": text or None}
    return None


def _reason_is_linked(reason: Optional[dict[str, Any]]) -> bool:
    if not reason:
        return False
    return bool(str(reason.get("explanation") or "").strip() or str(reason.get("code") or "").strip())


def _to_decimal(value: Any) -> Optional[Decimal]:
    number, error = parse_finite_number(value)
    if error:
        return None
    return number


def empty_stage_parameters(stage: str) -> list[dict[str, Any]]:
    defs = STAGE_PARAMETER_DEFS.get(str(stage or "").strip().upper(), ())
    rows: list[dict[str, Any]] = []
    for item in defs:
        rows.append(
            {
                "code": item.code,
                "label": item.label,
                "unit": item.default_unit,
                "method": None,
                "specimen": None,
                "sampling": None,
                "min": None,
                "max": None,
                "inclusive_min": True,
                "inclusive_max": True,
                "required": True,
                "applicable": item.conditional is None,
                "pair_group": item.pair_group,
                "conditional": item.conditional,
                "input_type": "number",
            }
        )
    return rows


def normalize_parameter_rule(raw: dict[str, Any], fallback: Optional[ParameterDef] = None) -> Optional[ParameterRule]:
    if not isinstance(raw, dict):
        return None
    code = str(raw.get("code") or raw.get("parameter_key") or raw.get("parameter_code") or "").strip()
    if not code and fallback is not None:
        code = fallback.code
    if not code:
        return None
    label = str(raw.get("label") or (fallback.label if fallback else code)).strip() or code
    unit = str(raw.get("unit") or (fallback.default_unit if fallback else "")).strip()
    applicable = raw.get("applicable")
    if applicable is None:
        applicable = True
    required = raw.get("required")
    if required is None:
        required = True
    return ParameterRule(
        code=code,
        label=label,
        unit=unit,
        method=(str(raw.get("method")).strip() if raw.get("method") not in (None, "") else None),
        specimen=(str(raw.get("specimen") or raw.get("basis")).strip() if raw.get("specimen") or raw.get("basis") else None),
        sampling=(str(raw.get("sampling")).strip() if raw.get("sampling") not in (None, "") else None),
        lower=_to_decimal(raw.get("min") if "min" in raw else raw.get("lower")),
        upper=_to_decimal(raw.get("max") if "max" in raw else raw.get("upper")),
        inclusive_min=bool(raw.get("inclusive_min", True)),
        inclusive_max=bool(raw.get("inclusive_max", True)),
        required=bool(required),
        applicable=bool(applicable),
        pair_group=raw.get("pair_group") or (fallback.pair_group if fallback else None),
        input_type=str(raw.get("input_type") or "number").strip().lower() or "number",
        options=list(raw.get("options") or []) if isinstance(raw.get("options"), list) else None,
    )


def rules_from_qc_profile(profile: Any, stage: str, *, notching_applicable: Optional[bool] = None) -> list[ParameterRule]:
    stage_key = str(stage or "").strip().upper()
    defs = {item.code: item for item in STAGE_PARAMETER_DEFS.get(stage_key, ())}
    rows: list[dict[str, Any]] = []
    if isinstance(profile, dict):
        stages = profile.get("stages") if isinstance(profile.get("stages"), dict) else profile
        stage_block = stages.get(stage_key) if isinstance(stages, dict) else None
        if stage_block is None and isinstance(stages, dict):
            stage_block = stages.get(stage_key.lower())
        if isinstance(stage_block, dict):
            raw_params = stage_block.get("parameters") or stage_block.get("metrics") or []
            if isinstance(raw_params, list):
                rows = [item for item in raw_params if isinstance(item, dict)]
        elif isinstance(profile.get("parameters"), list) and stage_key in {STAGE_INWARD, ""}:
            rows = [item for item in profile.get("parameters") if isinstance(item, dict)]
    by_code: dict[str, ParameterRule] = {}
    for raw in rows:
        fallback = defs.get(str(raw.get("code") or raw.get("parameter_key") or "").strip())
        rule = normalize_parameter_rule(raw, fallback)
        if rule:
            by_code[rule.code] = rule
    ordered: list[ParameterRule] = []
    seen: set[str] = set()
    for item in STAGE_PARAMETER_DEFS.get(stage_key, ()):
        rule = by_code.get(item.code)
        if rule is None:
            continue
        if item.conditional == "notching" and notching_applicable is False:
            rule.applicable = False
            rule.required = False
        ordered.append(rule)
        seen.add(item.code)
    for code, rule in by_code.items():
        if code not in seen:
            ordered.append(rule)
    return ordered


def rules_from_item_profile(profile: Any) -> tuple[str, list[ParameterRule]]:
    if not isinstance(profile, dict) or not profile:
        return "incomplete", []
    setup = str(profile.get("setup_status") or profile.get("status") or "").strip().lower()
    inspection_required = profile.get("inspection_required")
    if setup in {"not_required", "exemption", "approved_exemption"} or inspection_required is False:
        return VERDICT_NOT_REQUIRED, []
    raw_params = profile.get("parameters") or []
    rules: list[ParameterRule] = []
    if isinstance(raw_params, list):
        for raw in raw_params:
            rule = normalize_parameter_rule(raw if isinstance(raw, dict) else {})
            if rule:
                rules.append(rule)
    if not rules:
        return "incomplete", []
    return "ready", rules


def evaluate_parameter(rule: ParameterRule, reading: Any, reason: Optional[dict[str, Any]] = None) -> ParameterResult:
    if not rule.applicable:
        return ParameterResult(
            code=rule.code,
            label=rule.label,
            verdict=VERDICT_NOT_APPLICABLE,
            submitted=reading,
            rule=rule,
            message="Not applicable for this product.",
            reason=reason,
        )
    if rule.input_type in {"text", "select", "boolean", "categorical"}:
        allowed = [str(item) for item in (rule.options or []) if str(item).strip() != ""]
        if reading in (None, ""):
            verdict = VERDICT_INCOMPLETE if rule.required else VERDICT_OBSERVATION
            return ParameterResult(
                code=rule.code,
                label=rule.label,
                verdict=verdict,
                submitted=reading,
                rule=rule,
                message="Required observation is missing." if verdict == VERDICT_INCOMPLETE else "Optional observation.",
                reason=reason,
            )
        if allowed:
            if str(reading).strip() not in allowed:
                return ParameterResult(
                    code=rule.code,
                    label=rule.label,
                    verdict=VERDICT_FAIL,
                    submitted=reading,
                    rule=rule,
                    message=f"{rule.label} {reading} is not in the approved categorical outcomes {allowed}.",
                    reason=reason,
                )
            return ParameterResult(
                code=rule.code,
                label=rule.label,
                verdict=VERDICT_PASS,
                submitted=reading,
                rule=rule,
                message="Matches an approved categorical outcome.",
                reason=reason,
            )
        return ParameterResult(
            code=rule.code,
            label=rule.label,
            verdict=VERDICT_OBSERVATION,
            submitted=reading,
            rule=rule,
            message="Descriptive observation; text cannot establish a measured PASS without approved outcomes.",
            reason=reason,
        )
    number, error = parse_finite_number(reading)
    if error == "blank":
        verdict = VERDICT_INCOMPLETE if rule.required else VERDICT_OBSERVATION
        return ParameterResult(
            code=rule.code,
            label=rule.label,
            verdict=verdict,
            submitted=reading,
            rule=rule,
            message="Required reading is missing." if verdict == VERDICT_INCOMPLETE else "Optional reading omitted.",
            reason=reason,
        )
    if error == "invalid" or number is None:
        return ParameterResult(
            code=rule.code,
            label=rule.label,
            verdict=VERDICT_INVALID,
            submitted=reading,
            rule=rule,
            message="Reading is not a finite number.",
            reason=reason,
        )
    if not rule.has_numeric_rule():
        return ParameterResult(
            code=rule.code,
            label=rule.label,
            verdict=VERDICT_INCOMPLETE,
            submitted=reading,
            numeric_value=float(number),
            rule=rule,
            message="No approved numeric range is frozen for this parameter.",
            reason=reason,
        )
    if rule.lower is not None and rule.upper is not None and rule.lower > rule.upper:
        return ParameterResult(
            code=rule.code,
            label=rule.label,
            verdict=VERDICT_INVALID,
            submitted=reading,
            numeric_value=float(number),
            rule=rule,
            message="Approved bounds are inverted and cannot be evaluated.",
            reason=reason,
        )
    lower_ok = True
    upper_ok = True
    if rule.lower is not None:
        lower_ok = number >= rule.lower if rule.inclusive_min else number > rule.lower
    if rule.upper is not None:
        upper_ok = number <= rule.upper if rule.inclusive_max else number < rule.upper
    if lower_ok and upper_ok:
        return ParameterResult(
            code=rule.code,
            label=rule.label,
            verdict=VERDICT_PASS,
            submitted=reading,
            numeric_value=float(number),
            rule=rule,
            message="Within approved range.",
            reason=reason,
        )
    return ParameterResult(
        code=rule.code,
        label=rule.label,
        verdict=VERDICT_FAIL,
        submitted=reading,
        numeric_value=float(number),
        rule=rule,
        message=f"{rule.label} {float(number)} is outside {rule.allowed_display()}.",
        reason=reason,
    )


def _combine_verdicts(verdicts: Iterable[str], *, empty_verdict: str) -> str:
    rows = [str(item) for item in verdicts]
    if not rows:
        return empty_verdict
    actionable = [item for item in rows if item not in {VERDICT_NOT_APPLICABLE, VERDICT_NOT_REQUIRED}]
    use = actionable or rows
    best = use[0]
    best_rank = _VERDICT_RANK.get(best, 0)
    for verdict in use[1:]:
        rank = _VERDICT_RANK.get(verdict, 0)
        if rank > best_rank:
            best = verdict
            best_rank = rank
    return best


def evaluate_stage(
    *,
    stage: str,
    profile: Any,
    readings: dict[str, Any],
    reasons: Any = None,
    sample_id: Optional[str] = None,
    notching_applicable: Optional[bool] = None,
    require_reasons_on_fail: bool = True,
) -> InspectionEvaluation:
    stage_key = str(stage or "").strip().upper()
    revision = None
    if isinstance(profile, dict):
        revision = profile.get("revision") or profile.get("version")
    rules = rules_from_qc_profile(profile, stage_key, notching_applicable=notching_applicable)
    if not rules:
        return InspectionEvaluation(
            verdict=VERDICT_INCOMPLETE,
            parameter_results=[],
            failures=[],
            missing_reasons=[],
            frozen_rules=[],
            sample_id=sample_id,
            profile_revision=revision,
        )
    results: list[ParameterResult] = []
    checkpoint = str((readings or {}).get("oven_checkpoint") or (readings or {}).get("checkpoint") or "").strip().upper()
    pre_pair = str((readings or {}).get("pre_specimen_id") or (readings or {}).get("pre_pair_id") or "").strip()
    post_pair = str(
        (readings or {}).get("post_specimen_id")
        or (readings or {}).get("post_pair_id")
        or sample_id
        or ""
    ).strip()
    post_codes = {"post_weight", "post_moisture"}
    pre_codes = {"pre_weight", "pre_moisture"}
    post_present = any(_reading_for(readings or {}, code) not in (None, "") for code in post_codes)
    pre_present = any(_reading_for(readings or {}, code) not in (None, "") for code in pre_codes)
    pre_only = stage_key == STAGE_OVEN and (checkpoint in {"PRE", "PRE_ONLY"} or (pre_present and not post_present))
    for rule in rules:
        if pre_only and rule.code in post_codes:
            results.append(
                ParameterResult(
                    code=rule.code,
                    label=rule.label,
                    verdict=VERDICT_NOT_APPLICABLE,
                    submitted=None,
                    rule=rule,
                    message="Post checkpoint is not due until the identified pre specimen is re-measured.",
                )
            )
            continue
        reading = _reading_for(readings or {}, rule.code)
        reason = _reason_for(reasons, rule.code)
        result = evaluate_parameter(rule, reading, reason)
        if result.verdict == VERDICT_PASS and _reason_is_linked(reason):
            result.message = "Reason recorded; measured result remains PASS only because the reading is in range."
        results.append(result)

    if stage_key == STAGE_OVEN:
        pair_id = str(sample_id or (readings or {}).get("sample_id") or (readings or {}).get("pair_id") or "").strip()
        if post_present and not pair_id and not post_pair:
            results.append(
                ParameterResult(
                    code="sample_id",
                    label="Oven sample",
                    verdict=VERDICT_INCOMPLETE,
                    submitted=sample_id,
                    message="Post readings require the same identified sample/pair as the pre readings.",
                )
            )
        if post_present and pre_pair and post_pair and pre_pair != post_pair:
            results.append(
                ParameterResult(
                    code="oven_pair",
                    label="Oven pair",
                    verdict=VERDICT_FAIL,
                    submitted={"pre": pre_pair, "post": post_pair},
                    message="Post checkpoint specimen does not match the identified pre specimen. A free-text pair ID is not enough if the physical identities differ.",
                )
            )

    missing_reasons: list[str] = []
    failures: list[dict[str, Any]] = []
    for result in results:
        if result.verdict == VERDICT_FAIL:
            failures.append(result.as_dict())
            if require_reasons_on_fail and not _reason_is_linked(result.reason):
                missing_reasons.append(result.code)

    overall = _combine_verdicts((row.verdict for row in results), empty_verdict=VERDICT_INCOMPLETE)
    if overall == VERDICT_PASS and _reason_is_linked(_reason_for(reasons, "__overall__")):
        overall = VERDICT_PASS
    return InspectionEvaluation(
        verdict=overall,
        parameter_results=results,
        failures=failures,
        missing_reasons=missing_reasons,
        frozen_rules=[rule.as_dict() for rule in rules],
        sample_id=sample_id,
        profile_revision=revision,
    )


def evaluate_incoming(
    *,
    profile: Any,
    readings: dict[str, Any],
    reasons: Any = None,
    require_reasons_on_fail: bool = True,
) -> InspectionEvaluation:
    setup, rules = rules_from_item_profile(profile)
    if setup == VERDICT_NOT_REQUIRED:
        return InspectionEvaluation(
            verdict=VERDICT_NOT_REQUIRED,
            frozen_rules=[],
        )
    if setup == "incomplete" or not rules:
        return InspectionEvaluation(
            verdict=VERDICT_INCOMPLETE,
            parameter_results=[
                ParameterResult(
                    code="quality_profile",
                    label="Item quality profile",
                    verdict=VERDICT_INCOMPLETE,
                    message="Incoming QC has no approved item quality profile.",
                )
            ],
            frozen_rules=[],
        )
    results: list[ParameterResult] = []
    for rule in rules:
        reading = _reading_for(readings or {}, rule.code)
        reason = _reason_for(reasons, rule.code)
        result = evaluate_parameter(rule, reading, reason)
        results.append(result)
    missing_reasons: list[str] = []
    failures: list[dict[str, Any]] = []
    for result in results:
        if result.verdict == VERDICT_FAIL:
            failures.append(result.as_dict())
            if require_reasons_on_fail and not _reason_is_linked(result.reason):
                missing_reasons.append(result.code)
    overall = _combine_verdicts((row.verdict for row in results), empty_verdict=VERDICT_INCOMPLETE)
    revision = profile.get("revision") if isinstance(profile, dict) else None
    return InspectionEvaluation(
        verdict=overall,
        parameter_results=results,
        failures=failures,
        missing_reasons=missing_reasons,
        frozen_rules=[rule.as_dict() for rule in rules],
        profile_revision=revision,
    )


def evaluate_final_spec(
    *,
    spec_snapshot: dict[str, Any],
    readings: dict[str, Any],
    reasons: Any = None,
    require_reasons_on_fail: bool = True,
) -> InspectionEvaluation:
    """Existing final-acceptance fields (ID/OD/Length/Weight/C.S.).

    These stay on the approved spec snapshot. They are not copied into winding.
    """
    fields = (
        ("id", "ID", "mm", "id_min_mm", "id_max_mm"),
        ("od", "OD", "mm", "od_min_mm", "od_max_mm"),
        ("length", "Length", "mm", "length_min_mm", "length_max_mm"),
        ("weight", "Weight", "g", "weight_min_g", "weight_max_g"),
        ("cs", "CS", "N", "cs_min_n", "cs_max_n"),
    )
    rules: list[ParameterRule] = []
    for code, label, unit, min_key, max_key in fields:
        lower = _to_decimal((spec_snapshot or {}).get(min_key))
        upper = _to_decimal((spec_snapshot or {}).get(max_key))
        if lower is None and upper is None:
            continue
        rules.append(
            ParameterRule(
                code=code,
                label=label,
                unit=unit,
                lower=lower,
                upper=upper,
                required=True,
                applicable=True,
            )
        )
    results: list[ParameterResult] = []
    for rule in rules:
        reading = _reading_for(readings or {}, rule.code)
        reason = _reason_for(reasons, rule.code)
        results.append(evaluate_parameter(rule, reading, reason))
    missing_reasons: list[str] = []
    failures: list[dict[str, Any]] = []
    for result in results:
        if result.verdict == VERDICT_FAIL:
            failures.append(result.as_dict())
            if require_reasons_on_fail and not _reason_is_linked(result.reason):
                missing_reasons.append(result.code)
    overall = _combine_verdicts((row.verdict for row in results), empty_verdict=VERDICT_INCOMPLETE)
    return InspectionEvaluation(
        verdict=overall,
        parameter_results=results,
        failures=failures,
        missing_reasons=missing_reasons,
        frozen_rules=[rule.as_dict() for rule in rules],
    )


def evaluate_job_stage(
    *,
    stage: str,
    spec_snapshot: dict[str, Any],
    readings: dict[str, Any],
    reasons: Any = None,
    sample_id: Optional[str] = None,
    require_reasons_on_fail: bool = True,
) -> InspectionEvaluation:
    stage_key = str(stage or "").strip().upper()
    snapshot = spec_snapshot or {}
    profile = snapshot.get("qc_profile") if isinstance(snapshot.get("qc_profile"), dict) else None
    notching = snapshot.get("notch_capability_required")
    if notching is None:
        notching = bool(snapshot.get("notch_type") or snapshot.get("notch_distance_mm") or snapshot.get("notch_depth_mm"))
    if stage_key in {STAGE_WINDER, STAGE_OVEN, STAGE_PROCESS}:
        return evaluate_stage(
            stage=stage_key,
            profile=profile,
            readings=readings,
            reasons=reasons,
            sample_id=sample_id,
            notching_applicable=bool(notching) if stage_key == STAGE_PROCESS else None,
            require_reasons_on_fail=require_reasons_on_fail,
        )
    return evaluate_final_spec(
        spec_snapshot=snapshot,
        readings=readings,
        reasons=reasons,
        require_reasons_on_fail=require_reasons_on_fail,
    )


def submission_error(evaluation: InspectionEvaluation) -> Optional[str]:
    if evaluation.verdict == VERDICT_FAIL and evaluation.missing_reasons:
        labels = ", ".join(evaluation.missing_reasons)
        return f"FAIL requires a linked reason for: {labels}. A reason never creates PASS."
    return None


# ---------------------------------------------------------------------------
# p0 compatibility: typed stage validator against spec-snapshot bounds
# ---------------------------------------------------------------------------
#
# Distinct from ``evaluate_job_stage``, which requires a frozen qc_profile for
# WINDER/OVEN/PROCESS and will not copy finished-length limits into winding.
# This helper is the four-way INCOMPLETE/INVALID/PASS/FAIL checker used when
# only the approved spec snapshot bounds are available.

_DIMENSIONAL_FIELDS = [
    ("ID", "id", "id_min_mm", "id_max_mm"),
    ("OD", "od", "od_min_mm", "od_max_mm"),
    ("Length", "length", "length_min_mm", "length_max_mm"),
    ("Weight", "weight", "weight_min_g", "weight_max_g"),
    ("CS", "cs", "cs_min_n", "cs_max_n"),
]

STAGE_FIELD_SETS: dict[str, list[tuple[str, str, str, str]]] = {
    "WINDER": _DIMENSIONAL_FIELDS,
    "PROCESS": _DIMENSIONAL_FIELDS,
    "PACKING": _DIMENSIONAL_FIELDS,
    "QC": _DIMENSIONAL_FIELDS,
    "OVEN": [("Moisture", "moisture_after", "moisture_min_pct", "moisture_max_pct")],
}


@dataclass
class QualityEvaluation:
    status: str
    failures: list[dict[str, Any]] = field(default_factory=list)
    invalid: list[dict[str, Any]] = field(default_factory=list)
    incomplete: list[dict[str, Any]] = field(default_factory=list)

    @property
    def is_pass(self) -> bool:
        return self.status == "PASS"

    def issue_summary(self) -> str:
        parts: list[str] = []
        for item in self.failures:
            parts.append(
                f"{item['label']} out of range ({item['value']} not in {item['min']}..{item['max']})"
            )
        for item in self.invalid:
            parts.append(f"{item['label']} invalid ({item.get('detail', 'not a finite number')})")
        for item in self.incomplete:
            parts.append(f"{item['label']} incomplete ({item.get('detail', 'missing reading or bounds')})")
        return "; ".join(parts)


def _coerce_finite(raw: Any) -> tuple[str, Optional[float]]:
    """Return ("missing"|"invalid"|"ok", value).

    Booleans are rejected: ``True``/``False`` are not valid measurements even
    though Python treats them as ints.
    """
    if raw is None:
        return ("missing", None)
    if isinstance(raw, bool):
        return ("invalid", None)
    if isinstance(raw, str):
        stripped = raw.strip()
        if stripped == "":
            return ("missing", None)
        try:
            value = float(stripped)
        except ValueError:
            return ("invalid", None)
    else:
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return ("invalid", None)
    if not isfinite(value):
        return ("invalid", None)
    return ("ok", value)


def evaluate_stage_quality(
    stage_type: str,
    spec_snapshot: dict[str, Any],
    readings: dict[str, Any],
) -> QualityEvaluation:
    stage = str(stage_type or "").upper()
    spec = spec_snapshot or {}
    values = readings or {}
    fields = STAGE_FIELD_SETS.get(stage, [])

    failures: list[dict[str, Any]] = []
    invalid: list[dict[str, Any]] = []
    incomplete: list[dict[str, Any]] = []

    for label, reading_key, min_key, max_key in fields:
        reading_kind, reading_val = _coerce_finite(values.get(reading_key))
        min_kind, min_val = _coerce_finite(spec.get(min_key))
        max_kind, max_val = _coerce_finite(spec.get(max_key))

        applicable = reading_kind != "missing" or min_kind != "missing" or max_kind != "missing"
        if not applicable:
            continue

        if reading_kind == "invalid":
            invalid.append(
                {"label": label, "value": values.get(reading_key), "detail": "reading is not a finite number"}
            )
            continue
        if reading_kind == "missing":
            incomplete.append({"label": label, "detail": "required reading is missing"})
            continue

        if min_kind == "invalid" or max_kind == "invalid":
            invalid.append({"label": label, "detail": "spec bound is not a finite number"})
            continue
        if min_kind == "missing" or max_kind == "missing":
            incomplete.append({"label": label, "detail": "spec bounds are incomplete"})
            continue
        if min_val > max_val:
            invalid.append(
                {"label": label, "detail": "spec bounds are inverted (min > max)", "min": min_val, "max": max_val}
            )
            continue

        if reading_val < min_val or reading_val > max_val:
            failures.append({"label": label, "value": reading_val, "min": min_val, "max": max_val})

    if failures:
        status = "FAIL"
    elif invalid:
        status = "INVALID"
    elif incomplete:
        status = "INCOMPLETE"
    else:
        status = "PASS"

    return QualityEvaluation(status=status, failures=failures, invalid=invalid, incomplete=incomplete)


# ---------------------------------------------------------------------------
# p0 compatibility: incoming QC from frozen inventory templates (Q04)
# ---------------------------------------------------------------------------
#
# The ``inventory_quality_inspections.status`` column now also accepts
# INCOMPLETE/INVALID, but template evaluation still collapses missing/invalid
# evidence to FAIL so a caller cannot unlock stock by omitting a reading.
# The precise reason is preserved per-parameter in ``failures``.

FAILING_SELECT_TOKENS = {"FAIL", "FAILED", "REJECT", "REJECTED", "HOLD", "NO", "NG", "NOT_OK", "NOTOK"}


@dataclass
class IncomingQualityEvaluation:
    status: str
    failures: list[dict[str, Any]] = field(default_factory=list)

    def summary(self) -> str:
        return "; ".join(
            f"{item.get('label') or item.get('parameter')}: {item.get('reason')}"
            for item in self.failures
        )


def _reading_present(raw: Any) -> bool:
    if raw is None:
        return False
    if isinstance(raw, str):
        return raw.strip() != ""
    return True


def _is_finite_number(raw: Any) -> bool:
    if isinstance(raw, bool):
        return False
    try:
        value = float(str(raw).strip()) if isinstance(raw, str) else float(raw)
    except (TypeError, ValueError):
        return False
    return isfinite(value)


def evaluate_incoming_quality(template_rows: Iterable[Any], readings: dict[str, Any]) -> IncomingQualityEvaluation:
    """Compute PASS/FAIL from frozen template rules and recorded readings.

    ``template_rows`` are ``InventoryQualityTemplate`` objects (or any object with
    ``parameter_key``, ``label``, ``input_type``, ``options`` and ``required``).
    Client-authored status is never consulted.
    """
    values = readings or {}
    failures: list[dict[str, Any]] = []

    for row in template_rows:
        key = getattr(row, "parameter_key", None)
        if not key:
            continue
        label = getattr(row, "label", None) or key
        required = bool(getattr(row, "required", False))
        input_type = str(getattr(row, "input_type", "number") or "number").strip().lower()
        options = [str(opt).strip().upper() for opt in (getattr(row, "options", None) or [])]

        raw = values.get(key)
        present = _reading_present(raw)

        if not present:
            if required:
                failures.append(
                    {"parameter": key, "label": label, "reason": "MISSING", "detail": "required reading is missing"}
                )
            continue

        if input_type == "number":
            if not _is_finite_number(raw):
                failures.append(
                    {"parameter": key, "label": label, "reason": "INVALID", "value": raw, "detail": "reading is not a finite number"}
                )
                continue
        elif input_type == "select":
            token = str(raw).strip().upper()
            if options and token not in options:
                failures.append(
                    {"parameter": key, "label": label, "reason": "INVALID", "value": raw, "detail": f"value not in {options}"}
                )
                continue
            if token in FAILING_SELECT_TOKENS:
                failures.append(
                    {"parameter": key, "label": label, "reason": "FAIL", "value": raw, "detail": "failing selection"}
                )
                continue
        elif input_type == "boolean":
            token = str(raw).strip().upper()
            if token in {"FALSE", "NO", "0", "FAIL"}:
                failures.append(
                    {"parameter": key, "label": label, "reason": "FAIL", "value": raw, "detail": "failing boolean"}
                )
                continue

    status = "FAIL" if failures else "PASS"
    return IncomingQualityEvaluation(status=status, failures=failures)
