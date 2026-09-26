from datetime import date

import pytest

from src.job_card_numbering import format_job_card_no, next_suffix, root_number
from src.lifecycle_rules import (
    SegmentView,
    allowed_actions,
    lifecycle_state,
    made_qty,
    next_slot,
    plan_bump,
    plan_split_take,
    planned_in_stage_units,
    stage_units_to_pcs,
    within_output_tolerance,
)


def seg(id, status="QUEUED", planned=1000, output=0, machine=None, day=None, shift=None, seq=1, load=0, stage="WINDER"):
    return SegmentView(id=id, stage=stage, status=status, planned_qty=planned, output_qty=output, machine_id=machine, plan_date=day, shift_code=shift, sequence_no=seq, load=load)


def test_job_card_number_format_and_family_suffixes():
    assert format_job_card_no("2509", 1) == "25/09/01"
    assert format_job_card_no("2510", 123) == "25/10/123"
    assert root_number("25/09/01-B") == "25/09/01"
    assert next_suffix([], "25/09/01") == "A"
    assert next_suffix(["25/09/01-A", "25/09/01-C", "25/09/011-A"], "25/09/01") == "B"


def test_lifecycle_state_progression():
    assert lifecycle_state(status="PLANNED", close_mode=None, segments=[seg("a")]) == "QUEUED"
    assert lifecycle_state(status="PLANNED", close_mode=None, segments=[seg("a", "ASSIGNED", machine="m", day=date(2026, 9, 27), shift="SHIFT_A")]) == "SCHEDULED"
    assert lifecycle_state(status="IN_PROGRESS", close_mode=None, segments=[seg("a", "RUNNING", output=5)]) == "RUNNING"
    assert lifecycle_state(status="IN_PROGRESS", close_mode="FORCE", segments=[]) == "FORCE_CLOSED"
    assert lifecycle_state(status="CANCELLED", close_mode="CANCELLED", segments=[]) == "CANCELLED"


def test_only_queued_cards_are_editable():
    assert allowed_actions("QUEUED", has_release_lot=True, open_first_stage_qty=100)["edit"] is True
    scheduled = allowed_actions("SCHEDULED", has_release_lot=True, open_first_stage_qty=100)
    assert scheduled["edit"] is False and scheduled["force_close"] is True and scheduled["emergency"] is True
    assert allowed_actions("RUNNING", has_release_lot=True, open_first_stage_qty=0)["split"] is False
    assert allowed_actions("FORCE_CLOSED", has_release_lot=True, open_first_stage_qty=0)["running_entry"] is True


def test_ten_percent_output_tolerance():
    assert within_output_tolerance(2000, 2200)
    assert not within_output_tolerance(2000, 2201)


def test_bamboo_units_for_winder_and_oven():
    assert planned_in_stage_units("WINDER", 20000, 8) == 2500
    assert planned_in_stage_units("WINDER", 20001, 8) == 2501
    assert planned_in_stage_units("PROCESS", 20000, 8) == 20000
    assert stage_units_to_pcs("OVEN", 250, 8) == 2000
    assert made_qty([seg("a", "COMPLETED", output=100), seg("b", "RUNNING", output=50), seg("c", "QUEUED", output=0)]) == 150


def test_split_takes_from_latest_unstarted_segments():
    segments = [
        seg("early", "ASSIGNED", planned=4000, day=date(2026, 9, 27), shift="SHIFT_A"),
        seg("late", "ASSIGNED", planned=3000, day=date(2026, 9, 28), shift="SHIFT_B"),
        seg("run", "RUNNING", planned=5000, day=date(2026, 9, 26), shift="SHIFT_A"),
    ]
    assert plan_split_take(segments, 5000) == [("late", 0), ("early", 2000)]
    with pytest.raises(ValueError, match="Only 7,000 pcs"):
        plan_split_take(segments, 7001)


def test_emergency_bump_moves_lowest_priority_first_and_skips_pinned():
    slot = [seg("emg", "ASSIGNED", seq=1, load=600), seg("b", "ASSIGNED", seq=2, load=300), seg("c", "ASSIGNED", seq=3, load=300), seg("r", "RUNNING", seq=4, load=100)]
    assert plan_bump(slot, 1000, pinned_ids={"emg"}) == ["c"]
    assert plan_bump(slot, 800, pinned_ids={"emg"}) == ["c", "b"]
    assert plan_bump(slot, 2000, pinned_ids={"emg"}) == []


def test_next_slot_rolls_shift_then_day_and_skips_holidays():
    assert next_slot(date(2026, 9, 27), "SHIFT_A") == (date(2026, 9, 27), "SHIFT_B")
    assert next_slot(date(2026, 9, 27), "SHIFT_B") == (date(2026, 9, 28), "SHIFT_A")
    assert next_slot(date(2026, 9, 27), "SHIFT_B", {date(2026, 9, 28)}) == (date(2026, 9, 29), "SHIFT_A")
