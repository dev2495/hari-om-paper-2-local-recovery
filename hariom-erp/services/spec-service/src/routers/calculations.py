from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Dict, Any, List, Optional
import uuid
import math
from ..database import get_db
from ..models import RecipeHeader, SpecificationSheet
from ..utils.auth import apply_plant_scope, get_current_plant_scope, get_current_user
from ..calculators import calculate_weights, calculate_yield, generate_bom
from .. import spec_math

router = APIRouter(prefix="/calculate", tags=["calculations"])


class PreviewRecipeRow(BaseModel):
    paper_id: str = ""
    code: str = ""
    variety: str = ""
    category: str = ""
    gsm: float = 0.0
    thickness_per_ply: float = 0.0
    ply_count: int = 1


class PreviewAdhesiveComponent(BaseModel):
    id: Optional[str] = None
    name: str = ""
    base_percent: float = 15.0
    ratio_percent: float = 0.0


class CalculatePreviewPayload(BaseModel):
    tube_length_mm: float = 0.0
    tube_od_mm: float = 0.0
    tube_id_mm: float = 0.0
    target_dry_weight_g: float = 0.0
    drying_percent: float = 9.0
    parchment_percent: float = 1.5
    parchment_allowed: bool = True
    adhesive_percent: Optional[float] = None
    recipe_rows: List[PreviewRecipeRow] = []
    adhesive_components: List[PreviewAdhesiveComponent] = []


class SuggestionPaperCandidate(BaseModel):
    id: str = ""
    code: Optional[str] = ""
    variety: Optional[str] = ""
    category: Optional[str] = ""
    gsm: float = 0.0
    bf: Optional[float] = None
    thickness_mm: Optional[float] = None
    bulk_factor: Optional[float] = None


class CalculateSuggestionsPayload(BaseModel):
    tube_length_mm: float = 0.0
    tube_od_mm: float = 0.0
    tube_id_mm: float = 0.0
    target_wet_weight_g: float = 0.0
    drying_percent: float = spec_math.GLOBAL_MOISTURE_LOSS_PERCENT
    parchment_percent: float = spec_math.GLOBAL_PARCHMENT_PERCENT
    paper_candidates: List[SuggestionPaperCandidate] = []


def _paper_bulk(candidate: SuggestionPaperCandidate) -> float:
    gsm = float(candidate.gsm or 0.0)
    if candidate.bulk_factor not in (None, ""):
        return max(float(candidate.bulk_factor or 0.0), 0.0)
    if candidate.thickness_mm not in (None, "") and gsm > 0:
        return max(float(candidate.thickness_mm or 0.0) * 1000.0 / gsm, 0.0)
    return 1.0


def _suggestion_rows(
    combo: tuple[SuggestionPaperCandidate, ...],
    counts: tuple[int, ...],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, (candidate, count) in enumerate(zip(combo, counts), start=1):
        rows.append(
            {
                "id": f"{candidate.id or candidate.code}-{index}",
                "paper_id": candidate.id,
                "code": candidate.code,
                "variety": candidate.variety,
                "category": candidate.category,
                "gsm": float(candidate.gsm or 0.0),
                "bfPerPly": float(candidate.bf or 0.0),
                "thicknessPerPly": float(candidate.thickness_mm or 0.0),
                "plyCount": int(count),
                "positionsText": "",
            }
        )
    return rows


def _candidate_thickness_mm(candidate: SuggestionPaperCandidate) -> float:
    if candidate.thickness_mm not in (None, ""):
        return max(float(candidate.thickness_mm or 0.0), 0.0)
    return spec_math.thickness_mm(float(candidate.gsm or 0.0), _paper_bulk(candidate))


def _rough_paper_weight_g(
    candidate: SuggestionPaperCandidate,
    tube_length_mm: float,
    tube_id_mm: float,
    tube_od_mm: float,
) -> float:
    fallback_dia = tube_id_mm + _candidate_thickness_mm(candidate)
    avg_dia = max((tube_id_mm + tube_od_mm) / 2.0 if tube_od_mm > 0 else fallback_dia, fallback_dia, 1.0)
    return spec_math.per_ply_weight_per_mm(float(candidate.gsm or 0.0), avg_dia) * max(tube_length_mm, 0.0)


@router.get("/weight/{recipe_id}")
def get_weight_calculation(
    recipe_id: uuid.UUID,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """Calculate weights for a recipe"""
    # Verify recipe exists and belongs to plant
    recipe = apply_plant_scope(
        db.query(RecipeHeader).filter(RecipeHeader.id == recipe_id),
        RecipeHeader.plant_id,
        plant_scope,
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    try:
        result = calculate_weights(str(recipe_id), db)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {str(e)}")

@router.get("/yield/{spec_id}")
def get_yield_calculation(
    spec_id: uuid.UUID,
    tube_length_mm: int = 150,  # Default tube length, should come from masterdata
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """Calculate tubes per bamboo for a specification"""
    # Verify spec exists and belongs to plant
    spec = apply_plant_scope(
        db.query(SpecificationSheet).filter(SpecificationSheet.id == spec_id),
        SpecificationSheet.plant_id,
        plant_scope,
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Specification not found")
    
    try:
        result = calculate_yield(str(spec_id), tube_length_mm, db)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Calculation error: {str(e)}")

@router.get("/bom/{recipe_id}")
def get_bom(
    recipe_id: uuid.UUID,
    tube_length_mm: int = 150,
    tube_od_mm: int = 122,
    db: Session = Depends(get_db),
    plant_scope: dict = Depends(get_current_plant_scope),
    current_user: dict = Depends(get_current_user)
):
    """Generate Bill of Materials for one bamboo"""
    # Verify recipe exists and belongs to plant
    recipe = apply_plant_scope(
        db.query(RecipeHeader).filter(RecipeHeader.id == recipe_id),
        RecipeHeader.plant_id,
        plant_scope,
    ).first()
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    try:
        result = generate_bom(str(recipe_id), tube_length_mm, tube_od_mm, db)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BOM generation error: {str(e)}")


@router.post("/suggestions")
def calculate_suggestions(
    payload: CalculateSuggestionsPayload,
    _db: Session = Depends(get_db),
    _plant_scope: dict = Depends(get_current_plant_scope),
    _current_user: dict = Depends(get_current_user),
):
    target_wet = float(payload.target_wet_weight_g or 0.0)
    tube_length = float(payload.tube_length_mm or 0.0)
    tube_id = float(payload.tube_id_mm or 0.0)
    tube_od = float(payload.tube_od_mm or 0.0)
    if target_wet <= 0 or tube_length <= 0 or tube_id <= 0:
        return {"suggestions": []}

    unique: dict[str, SuggestionPaperCandidate] = {}
    for candidate in payload.paper_candidates or []:
        key = str(candidate.id or candidate.code or "").strip()
        if key and float(candidate.gsm or 0.0) > 0 and key not in unique:
            unique[key] = candidate

    candidates = sorted(unique.values(), key=lambda row: (float(row.gsm or 0.0), str(row.code or "")))
    if len(candidates) < spec_math.RECIPE_MIN_PAPERS:
        return {"suggestions": []}

    target_dry = target_wet * spec_math.dry_divisor(payload.drying_percent)
    target_paper = spec_math.required_paper_g(
        target_dry,
        adhesive_percent=spec_math.GLOBAL_ADHESIVE_PERCENT,
        parchment_percent=float(payload.parchment_percent or 0.0),
        moisture_loss_percent=float(payload.drying_percent or 0.0),
        parchment_allowed=True,
    )

    beam_limit = 64
    evaluation_limit = 700
    max_distinct = min(spec_math.RECIPE_MAX_PAPERS, len(candidates))
    max_plies = spec_math.RECIPE_MAX_PLIES

    def state_score(state: dict[str, Any]) -> tuple[float, int, int]:
        return (
            abs(float(state["rough_paper_weight_g"]) - target_paper),
            int(state["total_ply_count"]),
            len(state["rows"]),
        )

    def trim(states: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(states) <= beam_limit:
            return states
        return sorted(states, key=state_score)[:beam_limit]

    buckets: list[list[list[dict[str, Any]]]] = [
        [[] for _ in range(max_plies + 1)] for _ in range(max_distinct + 1)
    ]
    buckets[0][0] = [{"rows": [], "total_ply_count": 0, "rough_paper_weight_g": 0.0}]

    rough_candidates = [
        {
            "candidate": candidate,
            "rough_per_ply_g": _rough_paper_weight_g(candidate, tube_length, tube_id, tube_od),
        }
        for candidate in candidates
    ]

    for item in rough_candidates:
        next_buckets: list[list[list[dict[str, Any]]]] = [
            [states.copy() for states in by_ply] for by_ply in buckets
        ]
        for selected_count in range(0, max_distinct):
            for ply_count in range(0, max_plies):
                states = buckets[selected_count][ply_count]
                if not states:
                    continue
                max_count_for_paper = max_plies - ply_count
                for state in states:
                    for count in range(1, max_count_for_paper + 1):
                        next_buckets[selected_count + 1][ply_count + count].append(
                            {
                                "rows": [
                                    *state["rows"],
                                    {
                                        "candidate": item["candidate"],
                                        "count": count,
                                        "rough_per_ply_g": item["rough_per_ply_g"],
                                    },
                                ],
                                "total_ply_count": ply_count + count,
                                "rough_paper_weight_g": float(state["rough_paper_weight_g"])
                                + float(item["rough_per_ply_g"]) * count,
                            }
                        )

        for selected_count in range(0, max_distinct + 1):
            for ply_count in range(0, max_plies + 1):
                next_buckets[selected_count][ply_count] = trim(next_buckets[selected_count][ply_count])
        buckets = next_buckets

    final_states: list[dict[str, Any]] = []
    for selected_count in range(spec_math.RECIPE_MIN_PAPERS, max_distinct + 1):
        for ply_count in range(max(4, selected_count), max_plies + 1):
            final_states.extend(buckets[selected_count][ply_count])

    ranked_by_signature: dict[str, dict[str, Any]] = {}
    for state in sorted(final_states, key=state_score)[:evaluation_limit]:
        combo = tuple(row["candidate"] for row in state["rows"])
        counts = tuple(int(row["count"]) for row in state["rows"])
        papers = [
            spec_math.RecipePaper(
                paper_id=candidate.id,
                gsm=float(candidate.gsm or 0.0),
                bulk=_paper_bulk(candidate),
                ply_count=count,
                code=candidate.code or "",
            )
            for candidate, count in zip(combo, counts)
        ]
        preview = spec_math.compute_preview(
            mandrel_od_mm=tube_id,
            tube_length_mm=tube_length,
            papers=papers,
            target_dry_g=target_dry,
            adhesive_percent=spec_math.GLOBAL_ADHESIVE_PERCENT,
            parchment_percent=float(payload.parchment_percent or 0.0),
            moisture_loss_percent=float(payload.drying_percent or 0.0),
            parchment_allowed=True,
        )
        rows = _suggestion_rows(combo, counts)
        signature = "|".join(
            sorted(f"{row['code'] or row['paper_id']}:{row['plyCount']}" for row in rows)
        )
        suggestion = {
            "id": f"suggestion-{len(ranked_by_signature) + 1}",
            "title": " + ".join(f"{row['gsm']:.0f} GSM x {row['plyCount']}" for row in rows),
            "rows": rows,
            "predicted_paper_weight_g": preview.tube.paper_g,
            "predicted_dry_tube_g": preview.tube.dry_g,
            "predicted_wet_tube_g": preview.tube.wet_g,
            "delta_dry_g": round(preview.tube.dry_g - target_dry, 4),
            "delta_wet_g": round(preview.tube.wet_g - target_wet, 4),
            "total_ply_count": int(state["total_ply_count"]),
            "recipe_thickness_mm": preview.wall_mm,
            "effective_diameter_mm": preview.od_mm,
        }
        existing = ranked_by_signature.get(signature)
        if existing is None or (
            abs(float(suggestion["delta_dry_g"])) < abs(float(existing["delta_dry_g"]))
            or (
                math.isclose(abs(float(suggestion["delta_dry_g"])), abs(float(existing["delta_dry_g"])))
                and int(suggestion["total_ply_count"]) < int(existing["total_ply_count"])
            )
        ):
            ranked_by_signature[signature] = suggestion

    ranked = list(ranked_by_signature.values())
    ranked.sort(
        key=lambda row: (
            abs(float(row.get("delta_dry_g") or 0.0)),
            int(row.get("total_ply_count") or 999),
            str(row.get("title") or ""),
        )
    )
    return {"suggestions": ranked[:12]}


@router.post("/preview")
def calculate_preview(
    payload: CalculatePreviewPayload,
    _db: Session = Depends(get_db),
    _plant_scope: dict = Depends(get_current_plant_scope),
    _current_user: dict = Depends(get_current_user),
):
    adhesive_percent = (
        float(payload.adhesive_percent)
        if payload.adhesive_percent is not None
        else float(payload.adhesive_components[0].base_percent)
        if payload.adhesive_components
        else spec_math.GLOBAL_ADHESIVE_PERCENT
    )

    papers: List[spec_math.RecipePaper] = []
    for row in payload.recipe_rows:
        gsm = float(row.gsm or 0.0)
        thickness = float(row.thickness_per_ply or 0.0)
        bulk = (thickness * 1000.0 / gsm) if gsm > 0 else 0.0
        papers.append(
            spec_math.RecipePaper(
                paper_id=row.paper_id,
                gsm=gsm,
                bulk=bulk,
                ply_count=max(int(row.ply_count or 1), 1),
                code=row.code,
            )
        )

    preview = spec_math.compute_preview(
        mandrel_od_mm=float(payload.tube_id_mm or 0.0),
        tube_length_mm=float(payload.tube_length_mm or 0.0),
        papers=papers,
        target_dry_g=float(payload.target_dry_weight_g or 0.0),
        adhesive_percent=adhesive_percent,
        parchment_percent=float(payload.parchment_percent or 0.0),
        moisture_loss_percent=float(payload.drying_percent or 0.0),
        parchment_allowed=bool(payload.parchment_allowed),
    )

    ratio_total = sum(float(component.ratio_percent or 0.0) for component in payload.adhesive_components)
    adhesive_components = []
    for index, component in enumerate(payload.adhesive_components):
        ratio = float(component.ratio_percent or 0.0)
        weight = (preview.tube.adhesive_g * ratio / ratio_total) if ratio_total > 0 else 0.0
        adhesive_components.append(
            {
                "id": component.id or str(index + 1),
                "name": component.name or f"Adhesive {index + 1}",
                "ratio_percent": ratio,
                "base_percent": adhesive_percent,
                "weight_g": round(weight, 2),
            }
        )

    ply_cursor = 0
    ply_details = []
    for row in payload.recipe_rows:
        row_ply_count = max(int(row.ply_count or 1), 1)
        row_weight_per_mm = sum(preview.per_ply_weight_per_mm_g[ply_cursor: ply_cursor + row_ply_count])
        ply_cursor += row_ply_count
        ply_details.append(
            {
                "paper_id": row.paper_id,
                "code": row.code,
                "variety": row.variety,
                "gsm": row.gsm,
                "ply_count": row_ply_count,
                "weightG": round(row_weight_per_mm * float(payload.tube_length_mm or 0.0), 2),
            }
        )

    divisor = max(1.0 - float(payload.drying_percent or 0.0) / 100.0, 0.01)
    pre_moisture_target = float(payload.target_dry_weight_g or 0.0) / divisor if divisor else 0.0

    return {
        "summary": {
            "paper_total_g": round(preview.tube.paper_g, 2),
            "parchment_weight_g": round(preview.tube.parchment_g, 2),
            "adhesive_total_g": round(preview.tube.adhesive_g, 2),
            "adhesive_components": adhesive_components,
            "drying_percent_used": float(payload.drying_percent or 0.0),
            "pre_oven_divisor": round(divisor, 4),
            "pre_moisture_target_tube_g": round(pre_moisture_target, 2),
            "predicted_dry_tube_g": round(preview.tube.dry_g, 2),
            "predicted_wet_tube_g": round(preview.tube.wet_g, 2),
            "dry_delta_g": round(preview.validation.delta_g, 2),
            "wet_delta_g": round(preview.tube.wet_g - pre_moisture_target, 2),
            "weight_per_mm_g": round(preview.tube.wet_g / max(float(payload.tube_length_mm or 0.0), 1.0), 4),
            "paper_required_g": round(preview.paper_required_g, 2),
            "bamboo_required_wet_g": round(preview.bamboo.wet_g, 2),
            "bamboo_required_dry_g": round(preview.bamboo.dry_g, 2),
            "bamboo_required_paper_g": round(preview.bamboo.paper_g, 2),
            "selected_bamboo_length_mm": preview.bamboo_plan.bamboo_length_mm,
            "usable_length_mm": preview.bamboo_plan.usable_length_mm,
            "tube_length_mm": float(payload.tube_length_mm or 0.0),
            "tubes_per_bamboo": preview.bamboo_plan.tubes_per_bamboo,
            "ply_details": ply_details,
        },
        "validation": {
            "distinct_papers": preview.validation.distinct_papers,
            "total_plies": preview.validation.total_plies,
            "papers_ok": preview.validation.papers_ok,
            "plies_ok": preview.validation.plies_ok,
            "delta_g": preview.validation.delta_g,
            "delta_tolerance_g": preview.validation.delta_tolerance_g,
            "delta_ok": preview.validation.delta_ok,
            "ok": preview.validation.ok,
        },
    }
