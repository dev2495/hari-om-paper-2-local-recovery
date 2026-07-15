"""Canonical spec-sheet math.

Authoritative implementation. Mirror in TypeScript at
`apps/web-ui/lib/spec-math.ts`. Any change here must be ported there and
covered by tests on both sides.

All formulas are documented in `IMPLEMENTATION.md` (repo root).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Sequence

# ---------------------------------------------------------------------------
# Constants (defaults; per-spec overrides allowed in the Validation footer)
# ---------------------------------------------------------------------------

GLOBAL_ADHESIVE_PERCENT: float = 15.0
GLOBAL_PARCHMENT_PERCENT: float = 1.5
GLOBAL_MOISTURE_LOSS_PERCENT: float = 9.0

BAMBOO_LENGTH_MIN_MM: int = 1390
BAMBOO_LENGTH_MAX_MM: int = 1560
BAMBOO_LENGTH_STEP_MM: int = 10
BAMBOO_CUT_LOSS_MM: int = 40

MANDREL_TOLERANCE_MM: float = 0.1

RECIPE_MIN_PAPERS: int = 3
RECIPE_MAX_PAPERS: int = 5
RECIPE_MAX_PLIES: int = 18

DELTA_ABS_G: float = 3.0
DELTA_PCT: float = 0.0


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RecipePaper:
    """One paper in the recipe, repeated `ply_count` times in order."""

    paper_id: str
    gsm: float
    bulk: float
    ply_count: int
    code: str = ""


@dataclass(frozen=True)
class WeightBreakdown:
    paper_g: float
    adhesive_g: float
    parchment_g: float
    wet_g: float
    dry_g: float


@dataclass(frozen=True)
class BambooPlan:
    bamboo_length_mm: int
    tubes_per_bamboo: int
    trim_waste_mm: int
    usable_length_mm: int
    finished_length_mm: int
    fixed_end_trim_mm: int
    residual_offcut_mm: int
    total_trim_mm: int


@dataclass(frozen=True)
class RecipeValidation:
    distinct_papers: int
    total_plies: int
    papers_ok: bool
    plies_ok: bool
    delta_g: float
    delta_tolerance_g: float
    delta_ok: bool

    @property
    def ok(self) -> bool:
        return self.papers_ok and self.plies_ok and self.delta_ok


@dataclass(frozen=True)
class PreviewResult:
    id_mm: float
    od_mm: float
    wall_mm: float
    per_ply_thickness_mm: List[float]
    per_ply_avg_dia_mm: List[float]
    per_ply_weight_per_mm_g: List[float]
    target_per_ply_weight_per_mm_g: List[float]
    paper_weight_per_mm_g: float
    target_paper_weight_per_mm_g: float
    tube: WeightBreakdown
    nominal_tube: WeightBreakdown
    bamboo: WeightBreakdown
    bamboo_trim: WeightBreakdown
    whole_bamboo: WeightBreakdown
    bamboo_plan: BambooPlan
    paper_required_g: float
    paper_calibration_factor: float
    validation: RecipeValidation


# ---------------------------------------------------------------------------
# Core formulas
# ---------------------------------------------------------------------------

def thickness_mm(gsm: float, bulk: float) -> float:
    """`thickness_mm = GSM × bulk / 1000`.

    GSM in g/m², bulk in cm³/g. Handles zero / negative inputs by clamping.
    """
    if gsm is None or bulk is None:
        return 0.0
    return max(float(gsm), 0.0) * max(float(bulk), 0.0) / 1000.0


def expand_plies(papers: Sequence[RecipePaper]) -> List[RecipePaper]:
    """Expand `ply_count` so `papers[i]` is the i-th ply from inner to outer.

    Each returned entry has `ply_count == 1` and the same paper identity.
    """
    out: List[RecipePaper] = []
    for p in papers:
        for _ in range(max(int(p.ply_count or 0), 0)):
            out.append(
                RecipePaper(
                    paper_id=p.paper_id,
                    gsm=p.gsm,
                    bulk=p.bulk,
                    ply_count=1,
                    code=p.code,
                )
            )
    return out


def ply_geometry(
    id_mm: float, expanded: Sequence[RecipePaper]
) -> tuple[List[float], List[float], float]:
    """Return (per-ply thickness, per-ply avg_dia, wall_mm).

    Plies are iterated from inner (ply 1) to outer (ply N); wall is the sum
    of all thicknesses.
    """
    thicknesses: List[float] = []
    avg_dias: List[float] = []
    cumulative_inner: float = 0.0
    for p in expanded:
        t = thickness_mm(p.gsm, p.bulk)
        inner_d = id_mm + 2.0 * cumulative_inner
        avg_d = inner_d + t  # (inner + (inner + 2t)) / 2 = inner + t
        thicknesses.append(t)
        avg_dias.append(avg_d)
        cumulative_inner += t
    return thicknesses, avg_dias, cumulative_inner


def per_ply_weight_per_mm(gsm: float, avg_dia_mm: float) -> float:
    """Grams per mm of tube length for one ply.

    Surface area (m²) for 1 mm of tube = π × d(mm) × 1 / 1_000_000. Mass = GSM × area.
    """
    return max(float(gsm), 0.0) * math.pi * max(float(avg_dia_mm), 0.0) / 1_000_000.0


def dry_divisor(moisture_loss_percent: float = GLOBAL_MOISTURE_LOSS_PERCENT) -> float:
    return max(1.0 - max(float(moisture_loss_percent or 0.0), 0.0) / 100.0, 0.0001)


def addon_share(
    adhesive_percent: float = GLOBAL_ADHESIVE_PERCENT,
    parchment_percent: float = GLOBAL_PARCHMENT_PERCENT,
    parchment_allowed: bool = True,
) -> float:
    adhesive_share = max(float(adhesive_percent), 0.0) / 100.0
    parchment_share = max(float(parchment_percent), 0.0) / 100.0 if parchment_allowed else 0.0
    return adhesive_share + parchment_share


def wet_dry_breakdown(
    paper_g: float,
    *,
    adhesive_percent: float = GLOBAL_ADHESIVE_PERCENT,
    parchment_percent: float = GLOBAL_PARCHMENT_PERCENT,
    moisture_loss_percent: float = GLOBAL_MOISTURE_LOSS_PERCENT,
    parchment_allowed: bool = True,
    target_dry_g: float = 0.0,
) -> WeightBreakdown:
    paper_g = max(float(paper_g), 0.0)
    target_dry = max(float(target_dry_g or 0.0), 0.0)
    divisor = dry_divisor(moisture_loss_percent)
    addons = addon_share(adhesive_percent, parchment_percent, parchment_allowed)
    dry_base_g = target_dry if target_dry > 0 else paper_g * divisor / max(1.0 - divisor * addons, 0.0001)
    adhesive_g = dry_base_g * max(float(adhesive_percent), 0.0) / 100.0
    parchment_g = dry_base_g * max(float(parchment_percent), 0.0) / 100.0 if parchment_allowed else 0.0
    wet_g = paper_g + adhesive_g + parchment_g
    dry_g = wet_g * divisor
    return WeightBreakdown(
        paper_g=round(paper_g, 4),
        adhesive_g=round(adhesive_g, 4),
        parchment_g=round(parchment_g, 4),
        wet_g=round(wet_g, 4),
        dry_g=round(dry_g, 4),
    )


def scale_breakdown(breakdown: WeightBreakdown, factor: float) -> WeightBreakdown:
    """Scale one finished-tube breakdown to another length/count basis."""
    scale = max(float(factor or 0.0), 0.0)
    return WeightBreakdown(
        paper_g=round(breakdown.paper_g * scale, 4),
        adhesive_g=round(breakdown.adhesive_g * scale, 4),
        parchment_g=round(breakdown.parchment_g * scale, 4),
        wet_g=round(breakdown.wet_g * scale, 4),
        dry_g=round(breakdown.dry_g * scale, 4),
    )


def required_paper_g(
    target_dry_g: float,
    *,
    adhesive_percent: float = GLOBAL_ADHESIVE_PERCENT,
    parchment_percent: float = GLOBAL_PARCHMENT_PERCENT,
    moisture_loss_percent: float = GLOBAL_MOISTURE_LOSS_PERCENT,
    parchment_allowed: bool = True,
) -> float:
    """Reverse: paper needed when adhesive/parchment are percentages of client dry weight."""
    if target_dry_g is None or target_dry_g <= 0:
        return 0.0
    target_dry = float(target_dry_g)
    wet_target_g = target_dry / dry_divisor(moisture_loss_percent)
    adhesive_g = target_dry * max(float(adhesive_percent), 0.0) / 100.0
    parchment_g = target_dry * max(float(parchment_percent), 0.0) / 100.0 if parchment_allowed else 0.0
    return round(max(wet_target_g - adhesive_g - parchment_g, 0.0), 4)


# ---------------------------------------------------------------------------
# Bamboo plan
# ---------------------------------------------------------------------------

def build_bamboo_plan(
    tube_length_mm: float,
    *,
    min_length_mm: int = BAMBOO_LENGTH_MIN_MM,
    max_length_mm: int = BAMBOO_LENGTH_MAX_MM,
    step_mm: int = BAMBOO_LENGTH_STEP_MM,
    cut_loss_mm: int = BAMBOO_CUT_LOSS_MM,
) -> BambooPlan:
    """Pick the bamboo length that maximises tubes first, then minimises waste."""
    tube_len = max(int(round(tube_length_mm)), 1)
    best: Optional[BambooPlan] = None
    for L in range(max_length_mm, min_length_mm - 1, -step_mm):
        usable = max(L - cut_loss_mm, 0)
        tubes = usable // tube_len if tube_len else 0
        waste = usable - tubes * tube_len
        candidate = BambooPlan(
            bamboo_length_mm=L,
            tubes_per_bamboo=tubes,
            trim_waste_mm=waste,
            usable_length_mm=usable,
            finished_length_mm=tubes * tube_len,
            fixed_end_trim_mm=min(max(cut_loss_mm, 0), L),
            residual_offcut_mm=waste,
            total_trim_mm=max(L - tubes * tube_len, 0),
        )
        if best is None:
            best = candidate
            continue
        # tubes desc, waste asc, length desc
        if candidate.tubes_per_bamboo > best.tubes_per_bamboo:
            best = candidate
        elif candidate.tubes_per_bamboo == best.tubes_per_bamboo and candidate.trim_waste_mm < best.trim_waste_mm:
            best = candidate
    assert best is not None
    return best


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate_recipe(
    papers: Sequence[RecipePaper],
    target_dry_g: float,
    predicted_dry_g: float,
) -> RecipeValidation:
    distinct = {p.paper_id for p in papers if int(p.ply_count or 0) > 0}
    total_plies = sum(max(int(p.ply_count or 0), 0) for p in papers)
    papers_ok = RECIPE_MIN_PAPERS <= len(distinct) <= RECIPE_MAX_PAPERS
    plies_ok = 1 <= total_plies <= RECIPE_MAX_PLIES
    delta = (predicted_dry_g or 0.0) - (target_dry_g or 0.0)
    tol = DELTA_ABS_G
    delta_ok = abs(delta) <= tol
    return RecipeValidation(
        distinct_papers=len(distinct),
        total_plies=total_plies,
        papers_ok=papers_ok,
        plies_ok=plies_ok,
        delta_g=round(delta, 4),
        delta_tolerance_g=round(tol, 4),
        delta_ok=delta_ok,
    )


# ---------------------------------------------------------------------------
# Top-level orchestration (what POST /specs/preview returns)
# ---------------------------------------------------------------------------

def compute_preview(
    *,
    mandrel_od_mm: float,
    tube_length_mm: float,
    papers: Sequence[RecipePaper],
    target_dry_g: float,
    adhesive_percent: float = GLOBAL_ADHESIVE_PERCENT,
    parchment_percent: float = GLOBAL_PARCHMENT_PERCENT,
    moisture_loss_percent: float = GLOBAL_MOISTURE_LOSS_PERCENT,
    parchment_allowed: bool = True,
) -> PreviewResult:
    id_mm = max(float(mandrel_od_mm or 0.0), 0.0)
    tube_len = max(float(tube_length_mm or 0.0), 0.0)

    expanded = expand_plies(papers)
    thicknesses, avg_dias, wall = ply_geometry(id_mm, expanded)
    per_ply_wpm = [
        per_ply_weight_per_mm(p.gsm, d) for p, d in zip(expanded, avg_dias)
    ]
    paper_wpm = sum(per_ply_wpm)
    od_mm = id_mm + 2.0 * wall

    nominal_tube_paper_g = paper_wpm * tube_len
    nominal_tube = wet_dry_breakdown(
        nominal_tube_paper_g,
        adhesive_percent=adhesive_percent,
        parchment_percent=parchment_percent,
        moisture_loss_percent=moisture_loss_percent,
        parchment_allowed=parchment_allowed,
        target_dry_g=target_dry_g,
    )

    required = required_paper_g(
        target_dry_g,
        adhesive_percent=adhesive_percent,
        parchment_percent=parchment_percent,
        moisture_loss_percent=moisture_loss_percent,
        parchment_allowed=parchment_allowed,
    )
    has_recipe = nominal_tube_paper_g > 0 and len(expanded) > 0
    allocated_tube_paper_g = required if has_recipe and float(target_dry_g or 0.0) > 0 else nominal_tube_paper_g
    paper_calibration_factor = (
        allocated_tube_paper_g / nominal_tube_paper_g if nominal_tube_paper_g > 0 else 0.0
    )
    target_per_ply_wpm = [w * paper_calibration_factor for w in per_ply_wpm]
    target_paper_wpm = sum(target_per_ply_wpm)
    tube = (
        wet_dry_breakdown(
            allocated_tube_paper_g,
            adhesive_percent=adhesive_percent,
            parchment_percent=parchment_percent,
            moisture_loss_percent=moisture_loss_percent,
            parchment_allowed=parchment_allowed,
            target_dry_g=target_dry_g,
        )
        if has_recipe
        else WeightBreakdown(0.0, 0.0, 0.0, 0.0, 0.0)
    )

    plan = build_bamboo_plan(tube_len if tube_len else 1.0)
    tube_basis_mm = max(tube_len, 1.0)
    bamboo = scale_breakdown(tube, plan.tubes_per_bamboo)
    bamboo_trim = scale_breakdown(tube, plan.total_trim_mm / tube_basis_mm)
    whole_bamboo = scale_breakdown(tube, plan.bamboo_length_mm / tube_basis_mm)

    validation = validate_recipe(papers, target_dry_g or 0.0, tube.dry_g)

    return PreviewResult(
        id_mm=round(id_mm, 4),
        od_mm=round(od_mm, 4),
        wall_mm=round(wall, 4),
        per_ply_thickness_mm=[round(t, 4) for t in thicknesses],
        per_ply_avg_dia_mm=[round(d, 4) for d in avg_dias],
        per_ply_weight_per_mm_g=[round(w, 6) for w in per_ply_wpm],
        target_per_ply_weight_per_mm_g=[round(w, 6) for w in target_per_ply_wpm],
        paper_weight_per_mm_g=round(paper_wpm, 6),
        target_paper_weight_per_mm_g=round(target_paper_wpm, 6),
        tube=tube,
        nominal_tube=nominal_tube,
        bamboo=bamboo,
        bamboo_trim=bamboo_trim,
        whole_bamboo=whole_bamboo,
        bamboo_plan=plan,
        paper_required_g=required,
        paper_calibration_factor=round(paper_calibration_factor, 6),
        validation=validation,
    )


# ---------------------------------------------------------------------------
# Serialisation helper for the HTTP layer
# ---------------------------------------------------------------------------

def preview_to_dict(p: PreviewResult) -> dict:
    return {
        "id_mm": p.id_mm,
        "mandrel_tolerance_mm": MANDREL_TOLERANCE_MM,
        "od_mm": p.od_mm,
        "wall_mm": p.wall_mm,
        "per_ply_thickness_mm": p.per_ply_thickness_mm,
        "per_ply_avg_dia_mm": p.per_ply_avg_dia_mm,
        "per_ply_weight_per_mm_g": p.per_ply_weight_per_mm_g,
        "target_per_ply_weight_per_mm_g": p.target_per_ply_weight_per_mm_g,
        "paper_weight_per_mm_g": p.paper_weight_per_mm_g,
        "target_paper_weight_per_mm_g": p.target_paper_weight_per_mm_g,
        "tube": {
            "paper_g": p.tube.paper_g,
            "adhesive_g": p.tube.adhesive_g,
            "parchment_g": p.tube.parchment_g,
            "wet_g": p.tube.wet_g,
            "dry_g": p.tube.dry_g,
        },
        "nominal_tube": {
            "paper_g": p.nominal_tube.paper_g,
            "adhesive_g": p.nominal_tube.adhesive_g,
            "parchment_g": p.nominal_tube.parchment_g,
            "wet_g": p.nominal_tube.wet_g,
            "dry_g": p.nominal_tube.dry_g,
        },
        "bamboo": {
            "paper_g": p.bamboo.paper_g,
            "adhesive_g": p.bamboo.adhesive_g,
            "parchment_g": p.bamboo.parchment_g,
            "wet_g": p.bamboo.wet_g,
            "dry_g": p.bamboo.dry_g,
        },
        "bamboo_trim": {
            "paper_g": p.bamboo_trim.paper_g,
            "adhesive_g": p.bamboo_trim.adhesive_g,
            "parchment_g": p.bamboo_trim.parchment_g,
            "wet_g": p.bamboo_trim.wet_g,
            "dry_g": p.bamboo_trim.dry_g,
        },
        "whole_bamboo": {
            "paper_g": p.whole_bamboo.paper_g,
            "adhesive_g": p.whole_bamboo.adhesive_g,
            "parchment_g": p.whole_bamboo.parchment_g,
            "wet_g": p.whole_bamboo.wet_g,
            "dry_g": p.whole_bamboo.dry_g,
        },
        "bamboo_plan": {
            "bamboo_length_mm": p.bamboo_plan.bamboo_length_mm,
            "tubes_per_bamboo": p.bamboo_plan.tubes_per_bamboo,
            "trim_waste_mm": p.bamboo_plan.trim_waste_mm,
            "usable_length_mm": p.bamboo_plan.usable_length_mm,
            "finished_length_mm": p.bamboo_plan.finished_length_mm,
            "fixed_end_trim_mm": p.bamboo_plan.fixed_end_trim_mm,
            "residual_offcut_mm": p.bamboo_plan.residual_offcut_mm,
            "total_trim_mm": p.bamboo_plan.total_trim_mm,
        },
        "paper_required_g": p.paper_required_g,
        "paper_calibration_factor": p.paper_calibration_factor,
        "validation": {
            "distinct_papers": p.validation.distinct_papers,
            "total_plies": p.validation.total_plies,
            "papers_ok": p.validation.papers_ok,
            "plies_ok": p.validation.plies_ok,
            "delta_g": p.validation.delta_g,
            "delta_tolerance_g": p.validation.delta_tolerance_g,
            "delta_ok": p.validation.delta_ok,
            "ok": p.validation.ok,
        },
        "constants": {
            "adhesive_percent": adhesive_percent_value(),
            "parchment_percent": parchment_percent_value(),
            "moisture_loss_percent": moisture_loss_percent_value(),
            "bamboo_length_min_mm": BAMBOO_LENGTH_MIN_MM,
            "bamboo_length_max_mm": BAMBOO_LENGTH_MAX_MM,
            "bamboo_length_step_mm": BAMBOO_LENGTH_STEP_MM,
            "bamboo_cut_loss_mm": BAMBOO_CUT_LOSS_MM,
            "mandrel_tolerance_mm": MANDREL_TOLERANCE_MM,
            "recipe_min_papers": RECIPE_MIN_PAPERS,
            "recipe_max_papers": RECIPE_MAX_PAPERS,
            "recipe_max_plies": RECIPE_MAX_PLIES,
        },
    }


# Small accessor shims so the HTTP layer can surface the "defaults" while the
# preview call used possibly-overridden values. These are just the module
# constants; kept as functions in case future runtime config lookup is added.

def adhesive_percent_value() -> float:
    return GLOBAL_ADHESIVE_PERCENT


def parchment_percent_value() -> float:
    return GLOBAL_PARCHMENT_PERCENT


def moisture_loss_percent_value() -> float:
    return GLOBAL_MOISTURE_LOSS_PERCENT
