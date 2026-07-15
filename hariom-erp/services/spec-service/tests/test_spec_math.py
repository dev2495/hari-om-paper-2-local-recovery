"""Tests for the canonical spec math.

These are the round-trip fixtures the TS mirror must also satisfy
(see `apps/web-ui/__tests__/spec-math.test.ts`).
"""
from __future__ import annotations

import math

import pytest

from src.spec_math import (
    BAMBOO_CUT_LOSS_MM,
    BAMBOO_LENGTH_MAX_MM,
    BAMBOO_LENGTH_MIN_MM,
    BAMBOO_LENGTH_STEP_MM,
    DELTA_ABS_G,
    DELTA_PCT,
    GLOBAL_ADHESIVE_PERCENT,
    GLOBAL_MOISTURE_LOSS_PERCENT,
    GLOBAL_PARCHMENT_PERCENT,
    RECIPE_MAX_PAPERS,
    RECIPE_MAX_PLIES,
    RECIPE_MIN_PAPERS,
    RecipePaper,
    build_bamboo_plan,
    compute_preview,
    expand_plies,
    per_ply_weight_per_mm,
    ply_geometry,
    required_paper_g,
    thickness_mm,
    validate_recipe,
    wet_dry_breakdown,
)


# ----- thickness ---------------------------------------------------------------

@pytest.mark.parametrize(
    "gsm,bulk,expected",
    [
        (250, 1.30, 0.325),
        (300, 1.25, 0.375),
        (350, 1.20, 0.420),
        (237.5, 1.30, 0.30875),
        (0, 1.30, 0.0),
        (250, 0, 0.0),
    ],
)
def test_thickness_mm(gsm, bulk, expected):
    assert thickness_mm(gsm, bulk) == pytest.approx(expected, rel=1e-6)


# ----- ply expansion ----------------------------------------------------------

def test_expand_plies_preserves_order_and_count():
    papers = [
        RecipePaper("a", 250, 1.3, 2),
        RecipePaper("b", 300, 1.25, 1),
        RecipePaper("c", 350, 1.20, 1),
    ]
    out = expand_plies(papers)
    assert [p.paper_id for p in out] == ["a", "a", "b", "c"]
    assert all(p.ply_count == 1 for p in out)


# ----- geometry ---------------------------------------------------------------

def test_ply_geometry_single_paper():
    expanded = expand_plies([RecipePaper("p1", 250, 1.30, 3)])
    thicknesses, avg_dias, wall = ply_geometry(id_mm=50.0, expanded=expanded)
    # each ply is 0.325mm
    assert thicknesses == pytest.approx([0.325, 0.325, 0.325], rel=1e-9)
    # inner diameters: 50, 50.65, 51.30 → avg = 50.325, 50.975, 51.625
    assert avg_dias == pytest.approx([50.325, 50.975, 51.625], rel=1e-9)
    assert wall == pytest.approx(0.975, rel=1e-9)


def test_ply_geometry_multi_paper_ordered_inner_to_outer():
    papers = [
        RecipePaper("a", 250, 1.30, 2),  # thickness 0.325 each
        RecipePaper("b", 300, 1.25, 1),  # thickness 0.375
    ]
    thicknesses, avg_dias, wall = ply_geometry(
        id_mm=60.0, expanded=expand_plies(papers)
    )
    assert thicknesses == pytest.approx([0.325, 0.325, 0.375])
    # cumulative inner: 0, 0.325, 0.650 → inner dia 60, 60.65, 61.30
    # avg = inner + thickness
    assert avg_dias == pytest.approx([60.325, 60.975, 61.675])
    assert wall == pytest.approx(0.325 + 0.325 + 0.375)


# ----- per-mm weight ----------------------------------------------------------

def test_per_ply_weight_per_mm_matches_gsm_circumference_identity():
    gsm, avg_dia = 250.0, 50.0
    # surface for 1 mm of tube length in m²: π × d(mm) × 1 / 1_000_000
    expected = gsm * math.pi * avg_dia / 1_000_000
    assert per_ply_weight_per_mm(gsm, avg_dia) == pytest.approx(expected)


# ----- wet/dry breakdown ------------------------------------------------------

def test_wet_dry_breakdown_defaults_match_corrected_client_formula():
    """Adhesive/parchment are percentages of client dry weight."""
    b = wet_dry_breakdown(233.4753, target_dry_g=250.0)
    assert b.adhesive_g == pytest.approx(37.5, rel=1e-6)
    assert b.parchment_g == pytest.approx(3.75, rel=1e-6)
    assert b.wet_g == pytest.approx(274.7253, rel=1e-6)
    assert b.dry_g == pytest.approx(250.0, rel=1e-4)


def test_wet_dry_breakdown_keeps_additives_fixed_to_client_target():
    b = wet_dry_breakdown(247.69, target_dry_g=250.0)
    assert b.adhesive_g == pytest.approx(37.5, rel=1e-6)
    assert b.parchment_g == pytest.approx(3.75, rel=1e-6)
    assert b.wet_g == pytest.approx(288.94, rel=1e-6)
    assert b.dry_g == pytest.approx(262.9354, rel=1e-6)


def test_wet_dry_breakdown_parchment_disallowed():
    b = wet_dry_breakdown(94.8901, parchment_allowed=False, target_dry_g=100.0)
    assert b.parchment_g == 0.0
    assert b.adhesive_g == pytest.approx(15.0, rel=1e-6)
    assert b.wet_g == pytest.approx(109.8901, rel=1e-6)
    assert b.dry_g == pytest.approx(100.0, rel=1e-4)


def test_wet_dry_breakdown_custom_overrides():
    b = wet_dry_breakdown(
        91.1111,
        target_dry_g=100.0,
        adhesive_percent=18,
        parchment_percent=2,
        moisture_loss_percent=10,
    )
    assert b.adhesive_g == pytest.approx(18.0)
    assert b.parchment_g == pytest.approx(2.0)
    assert b.wet_g == pytest.approx(111.1111, rel=1e-6)
    assert b.dry_g == pytest.approx(100.0, rel=1e-4)


# ----- reverse required paper -------------------------------------------------

def test_required_paper_round_trip_with_defaults():
    target = 250.0
    req = required_paper_g(target)
    assert req == pytest.approx(target / 0.91 - target * 0.15 - target * 0.015, rel=1e-6)


def test_required_paper_zero_target():
    assert required_paper_g(0) == 0.0
    assert required_paper_g(None) == 0.0  # type: ignore[arg-type]


# ----- bamboo plan ------------------------------------------------------------

def test_bamboo_plan_prefers_most_tubes_then_least_waste():
    plan = build_bamboo_plan(150.0)
    # usable_length must be a multiple of tube_length if any waste exists; the
    # optimal plan at 150 mm tubes within [1390..1560] step 10, cut 40:
    # candidates with 10 tubes: usable ≥ 1500 → L ∈ {1540, 1550, 1560}, waste = usable − 1500
    # L=1540 → usable 1500 → waste 0 (best tie: length desc → 1540 first tried, waste 0 wins)
    assert plan.tubes_per_bamboo == 10
    assert plan.trim_waste_mm == 0
    assert plan.bamboo_length_mm == 1540


def test_bamboo_plan_tube_longer_than_bamboo_returns_zero_tubes():
    plan = build_bamboo_plan(2000.0)
    assert plan.tubes_per_bamboo == 0


def test_bamboo_length_range_constants():
    assert BAMBOO_LENGTH_MIN_MM == 1390
    assert BAMBOO_LENGTH_MAX_MM == 1560
    assert BAMBOO_LENGTH_STEP_MM == 10
    assert BAMBOO_CUT_LOSS_MM == 40


# ----- recipe validation ------------------------------------------------------

def test_recipe_validation_ok():
    papers = [
        RecipePaper("a", 250, 1.3, 2),
        RecipePaper("b", 300, 1.25, 1),
        RecipePaper("c", 350, 1.20, 1),
    ]
    v = validate_recipe(papers, target_dry_g=250.0, predicted_dry_g=250.5)
    assert v.ok
    assert v.distinct_papers == 3
    assert v.total_plies == 4


def test_recipe_validation_too_few_papers():
    papers = [RecipePaper("a", 250, 1.3, 2), RecipePaper("b", 300, 1.25, 1)]
    v = validate_recipe(papers, 250, 250)
    assert v.papers_ok is False
    assert v.ok is False


def test_recipe_validation_too_many_plies():
    papers = [
        RecipePaper("a", 250, 1.3, 10),
        RecipePaper("b", 300, 1.25, 5),
        RecipePaper("c", 350, 1.20, 5),
    ]  # 20 plies
    v = validate_recipe(papers, 250, 250)
    assert v.plies_ok is False


def test_recipe_validation_delta_outside_tolerance():
    papers = [
        RecipePaper("a", 250, 1.3, 2),
        RecipePaper("b", 300, 1.25, 1),
        RecipePaper("c", 350, 1.20, 1),
    ]
    # target 250, predicted 260 → delta 10 > 3 g fixed tolerance
    v = validate_recipe(papers, 250, 260)
    assert v.delta_ok is False


# ----- full preview -----------------------------------------------------------

def test_compute_preview_end_to_end():
    papers = [
        RecipePaper("a", 250, 1.30, 2),
        RecipePaper("b", 300, 1.25, 1),
        RecipePaper("c", 350, 1.20, 1),
    ]
    p = compute_preview(
        mandrel_od_mm=62.0,
        tube_length_mm=150.0,
        papers=papers,
        target_dry_g=250.0,
    )
    assert p.id_mm == 62.0
    assert p.wall_mm == pytest.approx(0.325 + 0.325 + 0.375 + 0.420)
    assert p.od_mm == pytest.approx(62.0 + 2 * p.wall_mm)
    assert p.paper_weight_per_mm_g > 0
    # tube dry must equal wet × (1 − moisture)
    assert p.tube.dry_g == pytest.approx(p.tube.wet_g * (1 - GLOBAL_MOISTURE_LOSS_PERCENT / 100), rel=1e-6)
    # bamboo dry × tubes_per_bamboo ≈ tube dry × (tubes) (scales linearly with usable length)
    # specifically bamboo_paper_g / tube_paper_g = usable_length / tube_length
    # Allow tolerance for the 4dp rounding on displayed weights
    assert p.bamboo.paper_g / p.tube.paper_g == pytest.approx(
        p.bamboo_plan.usable_length_mm / 150.0, rel=1e-3
    )
    # bamboo plan is one of the enumerated lengths
    assert BAMBOO_LENGTH_MIN_MM <= p.bamboo_plan.bamboo_length_mm <= BAMBOO_LENGTH_MAX_MM
    assert (p.bamboo_plan.bamboo_length_mm - BAMBOO_LENGTH_MIN_MM) % BAMBOO_LENGTH_STEP_MM == 0


def test_compute_preview_reverse_matches_wet_dry():
    papers = [
        RecipePaper("a", 250, 1.30, 2),
        RecipePaper("b", 300, 1.25, 1),
        RecipePaper("c", 350, 1.20, 1),
    ]
    target = 250.0
    p = compute_preview(
        mandrel_od_mm=62.0, tube_length_mm=150.0, papers=papers, target_dry_g=target,
    )
    recomputed = wet_dry_breakdown(p.paper_required_g, target_dry_g=target)
    assert recomputed.dry_g == pytest.approx(target, rel=1e-6)


def test_compute_preview_respects_parchment_toggle():
    papers = [RecipePaper("a", 250, 1.3, 3)]
    base = compute_preview(
        mandrel_od_mm=62.0, tube_length_mm=150, papers=papers, target_dry_g=100,
        parchment_allowed=True,
    )
    no_p = compute_preview(
        mandrel_od_mm=62.0, tube_length_mm=150, papers=papers, target_dry_g=100,
        parchment_allowed=False,
    )
    assert no_p.tube.parchment_g == 0.0
    assert no_p.paper_required_g > base.paper_required_g


def test_compute_preview_respects_custom_globals():
    papers = [RecipePaper("a", 250, 1.3, 3)]
    p = compute_preview(
        mandrel_od_mm=62.0, tube_length_mm=150, papers=papers, target_dry_g=100,
        adhesive_percent=18, parchment_percent=2, moisture_loss_percent=10,
    )
    assert p.tube.adhesive_g == pytest.approx(18.0, rel=1e-4)
    assert p.tube.parchment_g == pytest.approx(2.0, rel=1e-4)
    assert p.tube.dry_g == pytest.approx(p.tube.wet_g * 0.90, rel=1e-4)


def test_finished_tube_reconciles_target_and_trim_stays_separate():
    p = compute_preview(
        mandrel_od_mm=80.0,
        tube_length_mm=120.0,
        papers=[
            RecipePaper("230", 230, 1.30, 3),
            RecipePaper("301", 301, 1.40, 1),
            RecipePaper("355", 355, 1.40, 5),
            RecipePaper("351", 351, 1.45, 5),
        ],
        target_dry_g=230.0,
    )

    assert p.paper_required_g == pytest.approx(214.7973, abs=1e-4)
    assert p.tube.paper_g == pytest.approx(p.paper_required_g, abs=1e-4)
    assert p.tube.wet_g == pytest.approx(230.0 / 0.91, abs=1e-4)
    assert p.tube.dry_g == pytest.approx(230.0, abs=1e-4)
    assert p.validation.delta_g == pytest.approx(0.0, abs=1e-4)
    assert sum(p.target_per_ply_weight_per_mm_g) * 120.0 == pytest.approx(p.paper_required_g, rel=1e-5)

    assert p.bamboo_plan.bamboo_length_mm == 1480
    assert p.bamboo_plan.finished_length_mm == 1440
    assert p.bamboo_plan.fixed_end_trim_mm == 40
    assert p.bamboo_plan.residual_offcut_mm == 0
    assert p.bamboo_plan.total_trim_mm == 40
    assert p.bamboo.wet_g == pytest.approx(p.tube.wet_g * 12, abs=1e-3)
    assert p.bamboo_trim.wet_g == pytest.approx(p.tube.wet_g * 40 / 120, abs=1e-3)
    assert p.whole_bamboo.wet_g == pytest.approx(p.bamboo.wet_g + p.bamboo_trim.wet_g, abs=1e-3)


# ----- constants sanity -------------------------------------------------------

def test_defaults_match_workbook():
    assert GLOBAL_ADHESIVE_PERCENT == 15.0
    assert GLOBAL_PARCHMENT_PERCENT == 1.5
    assert GLOBAL_MOISTURE_LOSS_PERCENT == 9.0
    assert RECIPE_MIN_PAPERS == 3
    assert RECIPE_MAX_PAPERS == 5
    assert RECIPE_MAX_PLIES == 18
    assert DELTA_ABS_G == 3.0
    assert DELTA_PCT == 0.0
