"""Recipe/spec weight calculators.

Thin wrappers around `spec_math.compute_preview`; always delegate math to
`spec_math.py` so the TS mirror and API stay in lockstep.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

from . import spec_math
from .models import RecipeHeader, SpecificationSheet


def _get_recipe(recipe_id: str, db: Session) -> RecipeHeader:
    recipe = db.query(RecipeHeader).filter(RecipeHeader.id == recipe_id).first()
    if not recipe:
        raise ValueError("Recipe not found")
    return recipe


def _get_spec(spec_id: str, db: Session) -> SpecificationSheet:
    spec = db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id).first()
    if not spec:
        raise ValueError("Specification not found")
    return spec


def _recipe_to_papers(recipe: RecipeHeader) -> list[spec_math.RecipePaper]:
    grouped: dict[str, dict[str, Any]] = {}
    ordered_keys: list[str] = []
    for layer in sorted(recipe.layers, key=lambda r: (r.ply_no or 0)):
        key = str(layer.paper_id)
        if key not in grouped:
            grouped[key] = {
                "paper_id": key,
                "gsm": float(layer.gsm_snapshot or 0.0),
                "bulk": float(layer.bulk_snapshot or 0.0),
                "ply_count": 0,
            }
            ordered_keys.append(key)
        grouped[key]["ply_count"] += 1
    return [
        spec_math.RecipePaper(
            paper_id=grouped[k]["paper_id"],
            gsm=grouped[k]["gsm"],
            bulk=grouped[k]["bulk"],
            ply_count=grouped[k]["ply_count"],
        )
        for k in ordered_keys
    ]


def _spec_globals(spec: SpecificationSheet) -> dict[str, Any]:
    return {
        "adhesive_percent": float(spec.adhesive_percent) if spec.adhesive_percent is not None else spec_math.GLOBAL_ADHESIVE_PERCENT,
        "parchment_percent": float(spec.parchment_percent) if spec.parchment_percent is not None else spec_math.GLOBAL_PARCHMENT_PERCENT,
        "moisture_loss_percent": float(spec.moisture_loss_percent) if spec.moisture_loss_percent is not None else spec_math.GLOBAL_MOISTURE_LOSS_PERCENT,
        "parchment_allowed": bool(spec.parchment_allowed if spec.parchment_allowed is not None else True),
    }


def calculate_weights(recipe_id: str, db: Session, *, tube_length_mm: float | None = None) -> dict[str, Any]:
    recipe = _get_recipe(recipe_id, db)
    spec = recipe.specification
    papers = _recipe_to_papers(recipe)
    globals_ = _spec_globals(spec)

    preview = spec_math.compute_preview(
        mandrel_od_mm=0.0,
        tube_length_mm=tube_length_mm or 0.0,
        papers=papers,
        target_dry_g=float(spec.target_tube_weight or 0.0),
        **globals_,
    )

    return {
        "recipe_id": str(recipe.id),
        "spec_id": str(spec.id),
        "paper_ply_count": sum(p.ply_count for p in papers),
        "paper_gsm_total": sum(p.gsm * p.ply_count for p in papers),
        "paper_required_g": preview.paper_required_g,
        "estimated_paper_weight_g": preview.tube.paper_g,
        "estimated_parchment_weight_g": preview.tube.parchment_g,
        "estimated_adhesive_weight_g": preview.tube.adhesive_g,
        "estimated_wet_weight_g": preview.tube.wet_g,
        "estimated_finished_weight_g": preview.tube.dry_g,
        "globals": globals_,
    }


def calculate_yield(spec_id: str, tube_length_mm: int, db: Session) -> dict[str, Any]:
    spec = _get_spec(spec_id, db)
    plan = spec_math.build_bamboo_plan(float(tube_length_mm or 0))
    return {
        "spec_id": str(spec.id),
        "bamboo_max_length_mm": plan.bamboo_length_mm,
        "cut_loss_mm": spec_math.BAMBOO_CUT_LOSS_MM,
        "usable_length_mm": plan.usable_length_mm,
        "tube_length_mm": int(tube_length_mm or 0),
        "tubes_per_bamboo": plan.tubes_per_bamboo,
        "trim_waste_mm": plan.trim_waste_mm,
    }


def generate_bom(recipe_id: str, tube_length_mm: int, tube_od_mm: int, db: Session) -> dict[str, Any]:
    recipe = _get_recipe(recipe_id, db)
    spec = recipe.specification

    grouped_layers: dict[tuple[str, float, float], dict[str, Any]] = defaultdict(lambda: {"ply_count": 0})
    for layer in recipe.layers:
        key = (str(layer.paper_id), float(layer.gsm_snapshot or 0.0), float(layer.bf_snapshot or 0.0))
        grouped_layers[key]["paper_id"] = str(layer.paper_id)
        grouped_layers[key]["gsm_snapshot"] = float(layer.gsm_snapshot or 0.0)
        grouped_layers[key]["bf_snapshot"] = float(layer.bf_snapshot or 0.0)
        grouped_layers[key]["bulk_snapshot"] = float(layer.bulk_snapshot or 0.0)
        grouped_layers[key]["ply_count"] += 1

    weight_summary = calculate_weights(recipe_id, db, tube_length_mm=tube_length_mm)

    return {
        "recipe_id": str(recipe.id),
        "spec_id": str(spec.id),
        "tube_length_mm": int(tube_length_mm or 0),
        "tube_od_mm": int(tube_od_mm or 0),
        "paper_layers": list(grouped_layers.values()),
        "adhesive_split": {
            "adhesive_20100_percent": float(spec.adhesive_20100_percent or 0),
            "adhesive_30100_percent": float(spec.adhesive_30100_percent or 0),
        },
        "parchment_percent": float(spec.parchment_percent or 0),
        "weight_summary": weight_summary,
    }
