import uuid
from types import SimpleNamespace

import pytest

from src.color_allocation import (
    ColorAllocationError,
    ColorSplit,
    color_summary,
    line_commercials,
    normalize_color_splits,
    plan_color_release,
    released_by_color,
    validate_splits_cover_releases,
)


def lot(color, qty, status="released", color_id=None):
    return SimpleNamespace(parchment_color=color, parchment_color_id=color_id, released_qty=qty, status=status)


def test_breakup_can_leave_qty_unassigned_and_merges_duplicates():
    splits = normalize_color_splits(
        [{"color": "Blue", "qty": 2000}, {"color": "Red", "qty": 3000}, {"color": "blue", "qty": 0}, {"color": " Blue", "qty": 500}],
        line_qty=10000,
    )
    assert {s.color: s.qty for s in splits} == {"Blue": 2500, "Red": 3000}
    summary = color_summary(10000, splits, {})
    assert summary["unassigned_color_qty"] == 4500


def test_breakup_cannot_exceed_line_qty():
    with pytest.raises(ColorAllocationError, match="more than the line quantity"):
        normalize_color_splits([{"color": "Blue", "qty": 6000}, {"color": "Red", "qty": 5000}], line_qty=10000, line_no=2)


def test_release_within_color_needs_no_top_up():
    splits = [ColorSplit("Blue", 2000), ColorSplit("Red", 3000)]
    assert plan_color_release(line_qty=10000, splits=splits, released={}, color="Blue", color_id=None, release_qty=2000) == 0


def test_release_beyond_color_draws_from_unassigned():
    splits = [ColorSplit("Blue", 2000), ColorSplit("Red", 3000)]
    released = released_by_color([lot("Blue", 1500)])
    # 500 blue open + 5000 unassigned -> releasing 3000 blue needs 2500 moved in
    assert plan_color_release(line_qty=10000, splits=splits, released=released, color="Blue", color_id=None, release_qty=3000) == 2500
    # a brand-new color comes entirely from unassigned
    assert plan_color_release(line_qty=10000, splits=splits, released=released, color="Yellow", color_id=None, release_qty=5000) == 5000
    with pytest.raises(ColorAllocationError, match="cannot release"):
        plan_color_release(line_qty=10000, splits=splits, released=released, color="Yellow", color_id=None, release_qty=5001)


def test_cancelled_lots_do_not_consume_color_and_ids_win_over_names():
    color_id = uuid.uuid4()
    released = released_by_color([lot("Blue", 900, status="cancelled"), lot("Sky blue", 400, color_id=color_id)])
    assert sum(released.values()) == 400
    splits = [ColorSplit("Blue (renamed)", 400, color_id=color_id)]
    assert plan_color_release(line_qty=400, splits=splits, released=released, color="whatever", color_id=color_id, release_qty=0.0) == 0


def test_edited_breakup_cannot_drop_below_released():
    released = released_by_color([lot("Blue", 2000)])
    with pytest.raises(ColorAllocationError, match="already has 2,000 pcs released"):
        validate_splits_cover_releases([ColorSplit("Blue", 1500)], released, line_no=1)
    validate_splits_cover_releases([ColorSplit("Blue", 2000), ColorSplit("Red", 10)], released)


def test_colour_rates_value_each_colour_and_undecided_at_line_rate():
    splits = normalize_color_splits(
        [{"color": "Blue", "qty": 1000, "rate_per_pc": 52}, {"color": "Red", "qty": 500}],
        line_qty=2000,
    )
    assert {s.color: s.rate_per_pc for s in splits} == {"Blue": 52.0, "Red": None}
    summary = color_summary(2000, splits, {})
    assert {row["color"]: row["rate_per_pc"] for row in summary["color_splits"]} == {"Blue": 52.0, "Red": None}
    # Blue 1000 x 52 + Red 500 x 50 (line rate) + 500 undecided x 50
    result = line_commercials(2000, 50, splits)
    assert result["line_value"] == 102000.0
    assert result["effective_rate_per_pc"] == 51.0


def test_colour_rate_rules():
    with pytest.raises(ColorAllocationError, match="cannot be negative"):
        normalize_color_splits([{"color": "Blue", "qty": 10, "rate_per_pc": -1}], line_qty=10)
    with pytest.raises(ColorAllocationError, match="different rates"):
        normalize_color_splits([{"color": "Blue", "qty": 5, "rate_per_pc": 10}, {"color": "blue", "qty": 5, "rate_per_pc": 11}], line_qty=10)
    assert line_commercials(10, None, [ColorSplit("Blue", 10)]) == {"line_value": None, "effective_rate_per_pc": None}
