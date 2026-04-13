from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy.orm import Session

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


def calculate_weights(recipe_id: str, db: Session) -> dict[str, Any]:
    recipe = _get_recipe(recipe_id, db)
    spec = recipe.specification

    paper_ply_count = len(recipe.layers)
    total_gsm = sum(int(layer.gsm_snapshot or 0) for layer in recipe.layers)
    target_weight = float(spec.target_tube_weight or 0)
    parchment_percent = float(spec.parchment_percent or 0)
    adhesive_percent = float((spec.adhesive_20100_percent or 0) + (spec.adhesive_30100_percent or 0))

    dry_multiplier = 1 + parchment_percent / 100 + (adhesive_percent / 100) / 100
    estimated_paper_weight = round(target_weight / max(dry_multiplier, 1), 2) if target_weight else 0.0
    estimated_parchment_weight = round(estimated_paper_weight * (parchment_percent / 100), 2)
    estimated_adhesive_weight = round(estimated_paper_weight * ((adhesive_percent / 100) / 100), 2)

    return {
        "recipe_id": str(recipe.id),
        "spec_id": str(spec.id),
        "paper_ply_count": paper_ply_count,
        "paper_gsm_total": total_gsm,
        "estimated_paper_weight_g": estimated_paper_weight,
        "estimated_parchment_weight_g": estimated_parchment_weight,
        "estimated_adhesive_weight_g": estimated_adhesive_weight,
        "estimated_finished_weight_g": round(
            estimated_paper_weight + estimated_parchment_weight + estimated_adhesive_weight,
            2,
        ),
    }


def calculate_yield(spec_id: str, tube_length_mm: int, db: Session) -> dict[str, Any]:
    spec = _get_spec(spec_id, db)
    bamboo_length = int(spec.bamboo_max_length or 1560)
    cut_loss = int(spec.cut_loss_mm or 40)
    usable_length = max(bamboo_length - cut_loss, 0)
    effective_length = max(int(tube_length_mm or 0), 1)
    tubes_per_bamboo = usable_length // effective_length
    trim_waste = usable_length - tubes_per_bamboo * effective_length

    return {
        "spec_id": str(spec.id),
        "bamboo_max_length_mm": bamboo_length,
        "cut_loss_mm": cut_loss,
        "usable_length_mm": usable_length,
        "tube_length_mm": effective_length,
        "tubes_per_bamboo": tubes_per_bamboo,
        "trim_waste_mm": trim_waste,
    }


def generate_bom(recipe_id: str, tube_length_mm: int, tube_od_mm: int, db: Session) -> dict[str, Any]:
    recipe = _get_recipe(recipe_id, db)
    spec = recipe.specification

    grouped_layers: dict[tuple[str, int, int], dict[str, Any]] = defaultdict(lambda: {"ply_count": 0})
    for layer in recipe.layers:
        key = (str(layer.paper_id), int(layer.gsm_snapshot or 0), int(layer.bf_snapshot or 0))
        grouped_layers[key]["paper_id"] = str(layer.paper_id)
        grouped_layers[key]["gsm_snapshot"] = int(layer.gsm_snapshot or 0)
        grouped_layers[key]["bf_snapshot"] = int(layer.bf_snapshot or 0)
        grouped_layers[key]["ply_count"] += 1

    weight_summary = calculate_weights(recipe_id, db)

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
