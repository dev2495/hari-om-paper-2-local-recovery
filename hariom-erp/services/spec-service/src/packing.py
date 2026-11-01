"""Spec packing from the Packaging masters (owner decision 5, 1 Nov 2026).

The spec carries the box, plastic sheet and fadda by master code plus the per-box counts. Sizes and
per-piece weights are copied from the masters (read-only on the sheet); a packing amendment saved from
the Packing setup page rewrites only these keys.
"""
from __future__ import annotations

import math
import os
from typing import Any, Optional

import httpx
from fastapi import HTTPException

# Keys a packing amendment owns. Everything else on the spec stays as approved.
PACKING_AMENDMENT_KEYS = (
    "box_code",
    "box",
    "box_size",
    "box_unit_weight_kg",
    "qty_per_box",
    "plastic_required",
    "plastic_sku",
    "plastic_size",
    "plastic_unit_weight_kg",
    "plastic_weight_per_box_kg",
    "plastic_per_box",
    "fadda_sku",
    "fadda_unit_weight_kg",
    "fadda_weight_per_box_kg",
    "fadda_per_box",
)


def _number(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _text(value: Any) -> str:
    return str(value or "").strip()


def _fmt(value: Optional[float]) -> str:
    """Store numbers the way the spec sheet does: no trailing .0 on whole numbers."""
    if value is None:
        return ""
    rounded = round(float(value), 6)
    return str(int(rounded)) if rounded == int(rounded) else repr(rounded)


def current_packing(dynamic_map: dict[str, Any]) -> dict[str, Any]:
    """The packing a spec carries today, in plain fields (codes upper-cased as the masters store them)."""
    return {
        "box_code": _text(dynamic_map.get("box_code") or dynamic_map.get("box")),
        "qty_per_box": _number(dynamic_map.get("qty_per_box")),
        "box_size": _text(dynamic_map.get("box_size")),
        "box_unit_weight_kg": _number(dynamic_map.get("box_unit_weight_kg")),
        "plastic_sku": _text(dynamic_map.get("plastic_sku")),
        "plastic_per_box": _number(dynamic_map.get("plastic_per_box")),
        "plastic_size": _text(dynamic_map.get("plastic_size")),
        "plastic_unit_weight_kg": _number(dynamic_map.get("plastic_unit_weight_kg")),
        "fadda_sku": _text(dynamic_map.get("fadda_sku")),
        "fadda_per_box": _number(dynamic_map.get("fadda_per_box")),
        "fadda_unit_weight_kg": _number(dynamic_map.get("fadda_unit_weight_kg")),
    }


def packing_blockers(dynamic_map: dict[str, Any]) -> list[str]:
    """Approval blockers: a new spec (or revision) needs a box from the master and the qty per box."""
    packing = current_packing(dynamic_map)
    blockers: list[str] = []
    if not packing["box_code"]:
        blockers.append("Packing: choose the box from the Packaging master")
    qty = packing["qty_per_box"]
    if qty is None or qty <= 0 or qty != int(qty):
        blockers.append("Packing: enter the quantity per box (whole pieces)")
    return blockers


def packing_complete(dynamic_map: dict[str, Any]) -> bool:
    return not packing_blockers(dynamic_map)


def fetch_packaging_masters(*, plant_id: str, token: str) -> dict[str, dict[str, Any]]:
    """Active packaging masters of the plant keyed by upper-cased code (masterdata /unit-weights)."""
    url = os.getenv("MASTERDATA_SERVICE_URL", "http://127.0.0.1:18002")
    try:
        response = httpx.get(
            f"{url}/master/packaging/unit-weights",
            headers={"Authorization": f"Bearer {token}", "X-Plant-ID": str(plant_id)},
            timeout=8.0,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(503, "Could not read the Packaging masters; try again.") from exc
    if response.status_code >= 400:
        raise HTTPException(503, f"Could not read the Packaging masters (masterdata answered {response.status_code}); try again.")
    body = response.json() or {}
    return {str(code).upper(): row for code, row in (body.get("by_code") or {}).items()}


def _master(masters: dict[str, dict[str, Any]], code: str, kind: str, label: str) -> dict[str, Any]:
    row = masters.get(code.upper())
    if not row or str(row.get("kind")) != kind:
        raise HTTPException(
            422,
            {
                "code": "PACKAGING_MASTER_MISSING",
                "message": f"{label} {code} is not an active {label.lower()} in the Packaging master. Add it there first.",
                "missing_code": code,
                "kind": kind,
            },
        )
    return row


def amended_packing_values(
    *,
    box_code: str,
    qty_per_box: Any,
    plastic_sku: Optional[str],
    plastic_per_box: Any,
    fadda_sku: Optional[str],
    fadda_per_box: Any,
    masters: dict[str, dict[str, Any]],
) -> dict[str, str]:
    """Validated packing values for the spec, with sizes and per-piece weights taken from the masters."""
    box_code = _text(box_code).upper()
    if not box_code:
        raise HTTPException(422, "Choose the box from the Packaging master.")
    box = _master(masters, box_code, "BOX", "Box")
    qty = _number(qty_per_box)
    if qty is None or qty <= 0 or qty != int(qty):
        raise HTTPException(422, "Quantity per box must be a whole number of pieces above 0.")

    def material(sku: Optional[str], per_box: Any, kind: str, label: str) -> tuple[Optional[dict[str, Any]], Optional[float], str]:
        code = _text(sku).upper()
        count = _number(per_box)
        if count is not None and count < 0:
            raise HTTPException(422, f"{label} per box cannot be negative.")
        if not code:
            if count:
                raise HTTPException(422, f"Choose the {label.lower()} from the Packaging master, or set {label.lower()} per box to 0.")
            return None, None, ""
        if not count:
            raise HTTPException(422, f"Enter how many {label.lower()} pieces go in one box, or clear the {label.lower()}.")
        return _master(masters, code, kind, label), count, code

    plastic, plastic_count, plastic_code = material(plastic_sku, plastic_per_box, "PLASTIC", "Plastic")
    fadda, fadda_count, fadda_code = material(fadda_sku, fadda_per_box, "FADDA", "Fadda")

    def weight(row: Optional[dict[str, Any]]) -> Optional[float]:
        return _number(row.get("weight_kg")) if row else None

    plastic_weight = weight(plastic)
    fadda_weight = weight(fadda)
    return {
        "box_code": box_code,
        "box": box_code,
        "box_size": _text(box.get("size_label")),
        "box_unit_weight_kg": _fmt(weight(box)),
        "qty_per_box": _fmt(qty),
        "plastic_required": "true" if plastic else "false",
        "plastic_sku": plastic_code,
        "plastic_size": _text(plastic.get("size_label")) if plastic else "",
        "plastic_unit_weight_kg": _fmt(plastic_weight),
        "plastic_weight_per_box_kg": _fmt(round(plastic_count * plastic_weight, 4)) if plastic and plastic_weight is not None else "",
        "plastic_per_box": _fmt(plastic_count) if plastic else "0",
        "fadda_sku": fadda_code,
        "fadda_unit_weight_kg": _fmt(fadda_weight),
        "fadda_weight_per_box_kg": _fmt(round(fadda_count * fadda_weight, 4)) if fadda and fadda_weight is not None else "",
        "fadda_per_box": _fmt(fadda_count) if fadda else "0",
    }


def changed_keys(before: dict[str, Any], after: dict[str, str]) -> list[str]:
    return [key for key in PACKING_AMENDMENT_KEYS if _text(before.get(key)) != _text(after.get(key))]


def amendment_summary(values: dict[str, str]) -> str:
    bits = [f"Box {values.get('box_code')} × {values.get('qty_per_box')} pcs"]
    if values.get("plastic_sku"):
        bits.append(f"plastic {values['plastic_sku']} × {values.get('plastic_per_box')}/box")
    else:
        bits.append("no plastic")
    if values.get("fadda_sku"):
        bits.append(f"fadda {values['fadda_sku']} × {values.get('fadda_per_box')}/box")
    else:
        bits.append("no fadda")
    return ", ".join(bits)
