"""Usage limits per plant and material type (client 2026-10-28, spec 1 and 2.1).

- normal wastage %: added to the spec to give the expected use (paper 7, all others 0);
- allowed gap %: how far actual use may differ from expected (7 for every type);
- minimum gap: in the item's own unit, so tiny quantities never flag
  (paper 5 kg, adhesive 0.5 kg, parchment 1 kg, packing 10, other 5).

Allowed gap = max(allowed gap % x expected / 100, minimum gap). A plant without a saved row uses the
defaults below. Pure helpers plus one loader, so the month-end maths and its tests share them.
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import USAGE_LIMIT_MATERIAL_TYPES, PlantUsageLimit

DEFAULT_USAGE_LIMITS: dict[str, dict[str, float]] = {
    "RAW_PAPER": {"normal_wastage_pct": 7.0, "allowed_gap_pct": 7.0, "min_gap": 5.0},
    "ADHESIVE": {"normal_wastage_pct": 0.0, "allowed_gap_pct": 7.0, "min_gap": 0.5},
    "PARCHMENT": {"normal_wastage_pct": 0.0, "allowed_gap_pct": 7.0, "min_gap": 1.0},
    "PACKAGING": {"normal_wastage_pct": 0.0, "allowed_gap_pct": 7.0, "min_gap": 10.0},
    "OTHER": {"normal_wastage_pct": 0.0, "allowed_gap_pct": 7.0, "min_gap": 5.0},
}
MATERIAL_TYPE_LABELS = {
    "RAW_PAPER": "Paper",
    "ADHESIVE": "Adhesive",
    "PARCHMENT": "Parchment",
    "PACKAGING": "Packing",
    "OTHER": "Other",
}


def usage_limit_type(item_type: Optional[str]) -> str:
    """The limits row for an inventory item type (FINISHED_GOOD, TOOL and unknown types use OTHER)."""
    key = str(item_type or "").strip().upper()
    return key if key in USAGE_LIMIT_MATERIAL_TYPES else "OTHER"


def usage_limits_for_plant(db: Session, plant_id: Any) -> dict[str, dict[str, Any]]:
    """Effective limits of every material type for a plant: saved rows over the defaults.

    Each value is {normal_wastage_pct, allowed_gap_pct, min_gap, source: "PLANT"|"DEFAULT",
    updated_by, updated_at}.
    """
    saved = {
        row.material_type: row
        for row in db.query(PlantUsageLimit).filter(PlantUsageLimit.plant_id == plant_id).all()
    }
    limits: dict[str, dict[str, Any]] = {}
    for material_type in USAGE_LIMIT_MATERIAL_TYPES:
        row = saved.get(material_type)
        default = DEFAULT_USAGE_LIMITS[material_type]
        limits[material_type] = {
            "material_type": material_type,
            "label": MATERIAL_TYPE_LABELS[material_type],
            "normal_wastage_pct": float(row.normal_wastage_pct) if row else default["normal_wastage_pct"],
            "allowed_gap_pct": float(row.allowed_gap_pct) if row else default["allowed_gap_pct"],
            "min_gap": float(row.min_gap) if row else default["min_gap"],
            "source": "PLANT" if row else "DEFAULT",
            "updated_by": row.updated_by if row else None,
            "updated_at": row.updated_at.isoformat() if row and row.updated_at else None,
        }
    return limits


def expected_use(spec_qty: float, limits: dict[str, Any]) -> float:
    """Spec x (1 + normal wastage % / 100)."""
    return float(spec_qty or 0.0) * (1.0 + float(limits.get("normal_wastage_pct") or 0.0) / 100.0)


def allowed_gap(expected_qty: float, limits: dict[str, Any]) -> float:
    """max(allowed gap % x expected / 100, minimum gap), in the item's unit."""
    by_percent = abs(float(expected_qty or 0.0)) * float(limits.get("allowed_gap_pct") or 0.0) / 100.0
    return max(by_percent, float(limits.get("min_gap") or 0.0))


def gap_status(total_gap: Optional[float], allowed: float) -> str:
    """OK / OVER / UNDER, or NOT_KNOWN while actual use is not known (no approved month-end count)."""
    if total_gap is None:
        return "NOT_KNOWN"
    if total_gap > allowed + 1e-9:
        return "OVER"
    if total_gap < -allowed - 1e-9:
        return "UNDER"
    return "OK"
