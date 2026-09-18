"""One canonical final-tolerance representation (QCR-09).

Persisted owner: specification_sheet dimensional/weight/C.S. columns.
New editor (`qc_profile.final` or PUT /final-limits) and legacy column writes
go through this adapter. Conflicting dual writes are rejected. QC-only saves
cannot change contractual finals.
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException


CANONICAL_KEYS = (
    "id_min_mm",
    "id_max_mm",
    "od_min_mm",
    "od_max_mm",
    "length_min_mm",
    "length_max_mm",
    "weight_min_g",
    "weight_max_g",
    "cs_min_n",
    "cs_max_n",
)

FINAL_CODE_TO_COLUMNS = {
    "id": ("id_min_mm", "id_max_mm", "mm"),
    "od": ("od_min_mm", "od_max_mm", "mm"),
    "height": ("length_min_mm", "length_max_mm", "mm"),
    "weight": ("weight_min_g", "weight_max_g", "g"),
    "cs": ("cs_min_n", "cs_max_n", "N"),
}


def _finite(value: Any) -> Optional[float]:
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


def _values_conflict(left: Optional[float], right: Optional[float]) -> bool:
    if left is None or right is None:
        return False
    return abs(float(left) - float(right)) > 1e-9


def canonical_from_spec(spec: Any) -> dict[str, Optional[float]]:
    return {key: _finite(getattr(spec, key, None)) for key in CANONICAL_KEYS}


def extract_final_from_profile(profile: Any) -> dict[str, Optional[float]]:
    if not isinstance(profile, dict):
        return {}
    block = profile.get("final")
    if not isinstance(block, dict):
        return {}
    out: dict[str, Optional[float]] = {}
    for code, (min_key, max_key, _unit) in FINAL_CODE_TO_COLUMNS.items():
        row = block.get(code)
        if not isinstance(row, dict):
            continue
        if "min" in row:
            out[min_key] = _finite(row.get("min"))
        if "max" in row:
            out[max_key] = _finite(row.get("max"))
    return out


def reject_conflicting_final_writes(
    column_values: dict[str, Any],
    profile_final: dict[str, Any],
) -> None:
    for key in CANONICAL_KEYS:
        if key not in column_values or key not in profile_final:
            continue
        if _values_conflict(_finite(column_values.get(key)), _finite(profile_final.get(key))):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "CONFLICTING_FINAL_LIMITS",
                    "message": (
                        f"Canonical final field {key} was written two ways with different values. "
                        "Use one editor; old columns are compatibility projections of the same rule."
                    ),
                    "field": key,
                },
            )


def merge_canonical_into_payload(payload: Any) -> None:
    dumped = payload.model_dump(exclude_unset=True)
    columns = {key: dumped[key] for key in CANONICAL_KEYS if key in dumped}
    profile_final = extract_final_from_profile(dumped.get("qc_profile"))
    reject_conflicting_final_writes(columns, profile_final)
    for key, value in profile_final.items():
        if key not in columns or columns.get(key) is None:
            setattr(payload, key, value)


def reject_qc_contractual_final(profile: Any, spec: Any) -> None:
    extracted = extract_final_from_profile(profile)
    if not extracted:
        return
    current = canonical_from_spec(spec)
    reject_conflicting_final_writes(current, extracted)
    raise HTTPException(
        status_code=409,
        detail={
            "code": "CONTRACTUAL_FINAL_REQUIRES_SPEC_COMMAND",
            "message": (
                "Contractual final limits require the spec final-limits command "
                "(or legacy spec fields), not a QC-only save."
            ),
        },
    )


def project_final_block(canonical: dict[str, Optional[float]]) -> dict[str, Any]:
    return {
        code: {
            "min": canonical.get(min_key),
            "max": canonical.get(max_key),
            "unit": unit,
            "source": "canonical",
        }
        for code, (min_key, max_key, unit) in FINAL_CODE_TO_COLUMNS.items()
    }


def project_onto_profile(profile: Any, canonical: dict[str, Optional[float]]) -> Optional[dict[str, Any]]:
    if not isinstance(profile, dict):
        if not any(value is not None for value in canonical.values()):
            return profile if isinstance(profile, dict) else None
        return {"final": project_final_block(canonical)}
    copied = dict(profile)
    copied["final"] = project_final_block(canonical)
    return copied
