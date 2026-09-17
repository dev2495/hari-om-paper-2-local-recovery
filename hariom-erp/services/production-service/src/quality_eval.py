"""Single typed quality evaluator for production-stage inspections.

Historically two copies of the range checker lived in ``routers/quality.py`` and
``routers/planning.py``. Both silently *skipped* a parameter whenever the reading
was non-numeric/blank or the spec bounds were incomplete, and then declared the
inspection ``PASS`` because "no failures were collected" (audit finding S07).

This module is the one place that decides a stage verdict. It requires finite
numeric readings and complete finite bounds, and returns a four-way evaluation so
callers can distinguish:

* ``PASS``        every applicable reading is finite and within its finite bounds
* ``FAIL``        at least one finite reading is outside its finite bounds
* ``INVALID``     a supplied reading (or spec bound) is not a finite number, or a
                  bound pair is inverted (min > max)
* ``INCOMPLETE``  an applicable reading or one of its bounds is missing/blank

Invalid, blank and incomplete inputs are therefore never reported as ``PASS``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Optional

# Candidate parameters per stage: (label, reading_key, min_bound_key, max_bound_key).
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
    if not math.isfinite(value):
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

        # A parameter is only evaluated when the spec defines a bound for it or a
        # reading was supplied. Otherwise it is genuinely not part of this stage's
        # approved check set and is skipped.
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
