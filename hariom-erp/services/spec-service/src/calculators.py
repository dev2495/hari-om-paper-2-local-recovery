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


def _effective_bulk(value: Any) -> float:
    try:
        bulk = float(value or 0.0)
    except (TypeError, ValueError):
        bulk = 0.0
    return bulk if bulk > 0 else 1.0


def _recipe_to_papers(recipe: RecipeHeader) -> list[spec_math.RecipePaper]:
    grouped: dict[str, dict[str, Any]] = {}
    ordered_keys: list[str] = []
    for layer in sorted(recipe.layers, key=lambda r: (r.ply_no or 0)):
        key = str(layer.paper_id)
        if key not in grouped:
            grouped[key] = {
                "paper_id": key,
                "gsm": float(layer.gsm_snapshot or 0.0),
                "bulk": _effective_bulk(layer.bulk_snapshot),
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

    grouped_layers: dict[tuple[str, float, float, float], dict[str, Any]] = defaultdict(lambda: {"ply_count": 0})
    for layer in recipe.layers:
        effective_bulk = _effective_bulk(layer.bulk_snapshot)
        key = (
            str(layer.paper_id),
            float(layer.gsm_snapshot or 0.0),
            float(layer.bf_snapshot or 0.0),
            effective_bulk,
        )
        grouped_layers[key]["paper_id"] = str(layer.paper_id)
        grouped_layers[key]["gsm_snapshot"] = float(layer.gsm_snapshot or 0.0)
        grouped_layers[key]["bf_snapshot"] = float(layer.bf_snapshot or 0.0)
        grouped_layers[key]["bulk_snapshot"] = effective_bulk
        grouped_layers[key]["ply_count"] += 1

    weight_summary = calculate_weights(recipe_id, db, tube_length_mm=tube_length_mm)
    preview_papers = _recipe_to_papers(recipe)
    globals_ = _spec_globals(spec)
    preview = spec_math.compute_preview(
        mandrel_od_mm=0.0,
        tube_length_mm=float(tube_length_mm or 0),
        papers=preview_papers,
        target_dry_g=float(spec.target_tube_weight or 0.0),
        **globals_,
    )
    divisor = spec_math.dry_divisor(globals_["moisture_loss_percent"])
    pre_moisture_target = float(spec.target_tube_weight or 0.0) / divisor if divisor else 0.0
    weight_bridge = {
        "pre_oven_divisor": round(divisor, 4),
        "pre_moisture_target_tube_g": round(pre_moisture_target, 6),
        "predicted_dry_tube_g": preview.tube.dry_g,
        "predicted_wet_tube_g": preview.tube.wet_g,
        "predicted_per_tube_weight_g": preview.tube.dry_g,
        "weight_match_delta_g": round(preview.tube.wet_g - pre_moisture_target, 6),
        "dry_weight_per_mm_g": round(preview.tube.dry_g / max(float(tube_length_mm or 0), 1.0), 6),
        "wet_weight_per_mm_g": round(preview.tube.wet_g / max(float(tube_length_mm or 0), 1.0), 6),
        "weight_per_mm_g": round(preview.tube.wet_g / max(float(tube_length_mm or 0), 1.0), 6),
        "paper_required_g": preview.paper_required_g,
        "bamboo_required_wet_g": preview.bamboo.wet_g,
        "bamboo_required_dry_g": preview.bamboo.dry_g,
        "bamboo_required_paper_g": preview.bamboo.paper_g,
    }
    total_gsm_plies = sum(float(row["gsm_snapshot"] or 0.0) * int(row["ply_count"] or 0) for row in grouped_layers.values())
    paper_rows = []
    for row in grouped_layers.values():
        share = (
            float(row["gsm_snapshot"] or 0.0) * int(row["ply_count"] or 0) / total_gsm_plies
            if total_gsm_plies > 0
            else 0.0
        )
        paper_rows.append(
            {
                "paper_id": row["paper_id"],
                "gsm": row["gsm_snapshot"],
                "bf": row["bf_snapshot"],
                "bulk": row["bulk_snapshot"],
                "ply_count": row["ply_count"],
                "weight_kg": round(preview.bamboo.paper_g * share / 1000.0, 6),
            }
        )

    adhesive_20100 = float(spec.adhesive_20100_percent or 0.0)
    adhesive_30100 = float(spec.adhesive_30100_percent or 0.0)
    split_total = adhesive_20100 + adhesive_30100
    adhesive_components = []
    if split_total > 0:
        adhesive_components = [
            {"name": "20100", "ratio_percent": adhesive_20100, "weight_kg": round(preview.bamboo.adhesive_g * adhesive_20100 / split_total / 1000.0, 6)},
            {"name": "30100", "ratio_percent": adhesive_30100, "weight_kg": round(preview.bamboo.adhesive_g * adhesive_30100 / split_total / 1000.0, 6)},
        ]
    elif preview.bamboo.adhesive_g > 0:
        adhesive_components = [{"name": "Adhesive", "ratio_percent": 100.0, "weight_kg": round(preview.bamboo.adhesive_g / 1000.0, 6)}]
    calculation_references = {
        "weight_calculation": {
            "paper_total_g": preview.tube.paper_g,
            "adhesive_total_g": preview.tube.adhesive_g,
            "parchment_weight_g": preview.tube.parchment_g,
            "pre_oven_divisor": round(divisor, 4),
            "pre_moisture_target_tube_g": round(pre_moisture_target, 6),
            "predicted_dry_tube_g": preview.tube.dry_g,
            "predicted_wet_tube_g": preview.tube.wet_g,
            "paper_required_g": preview.paper_required_g,
        }
    }

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
        "weight_bridge": weight_bridge,
        "calculation_references": calculation_references,
        "raw_materials": {
            "papers": paper_rows,
            "adhesives": {
                "total_adhesive_weight_kg": round(preview.bamboo.adhesive_g / 1000.0, 6),
                "components": adhesive_components,
            },
            "parchment": {
                "color": spec.parchment_color,
                "addition_percent": float(spec.parchment_percent or 0.0),
                "weight_kg": round(preview.bamboo.parchment_g / 1000.0, 6),
            },
            "total_input_weight_kg": round(preview.bamboo.wet_g / 1000.0, 6),
        },
        "expected_output": {
            "per_tube_weight_kg": round(preview.tube.dry_g / 1000.0, 6),
            "per_tube_wet_weight_kg": round(preview.tube.wet_g / 1000.0, 6),
            "tubes_per_bamboo": preview.bamboo_plan.tubes_per_bamboo,
        },
    }
