"""Plan vs actual and shift spelling (client 2026-10-25)."""
from datetime import date

import pytest

from src.lifecycle_rules import canonical_shift
from src.routers.plan_actual import classify, shift_window
from src.schemas.planning import StageOutputPayload

PLAN = {"plan_date": "2026-10-25", "shift_code": "SHIFT_A", "machine_id": "w1"}


def test_run_on_the_planned_day_shift_and_machine_is_as_planned():
    assert classify({"date": date(2026, 10, 25), "shift_code": "SHIFT_A", "machine_id": "w1"}, PLAN, None)["status"] == "ON_PLAN"


def test_each_difference_is_named():
    result = classify({"date": date(2026, 10, 27), "shift_code": "SHIFT_B", "machine_id": "w2"}, PLAN, None)
    assert result["status"] == "OFF_PLAN" and result["deviations"] == ["LATE", "SHIFT", "MACHINE"] and result["days_off"] == 2
    assert classify({"date": date(2026, 10, 24), "shift_code": "A"}, PLAN, None)["deviations"] == ["EARLY"]


def test_card_time_outside_the_planned_shift_is_flagged():
    inside = classify({"date": date(2026, 10, 25), "shift_code": "SHIFT_A", "start": "2026-10-25T09:00", "end": "2026-10-25T17:30"}, PLAN, None)
    outside = classify({"date": date(2026, 10, 25), "shift_code": "SHIFT_A", "start": "2026-10-25T06:30", "end": "2026-10-25T09:00"}, PLAN, None)
    assert inside["time_check"] == "IN_SLOT" and inside["status"] == "ON_PLAN"
    assert outside["time_check"] == "OUTSIDE_SLOT" and outside["deviations"] == ["TIME"]
    assert shift_window(date(2026, 10, 25), "SHIFT_B")[0].hour == 20


def test_run_without_a_plan_is_run_before_planning():
    flagged = classify({"date": date(2026, 10, 25)}, PLAN, {"reason": "Schedule this stage first"})
    assert flagged["status"] == "UNPLANNED" and flagged["reason"] == "The stage was not on the planner when the run was entered."
    assert classify({"date": date(2026, 10, 25)}, None, {"reason": "Ask the plant head"})["reason"] == "Ask the plant head"
    expired = classify({"date": date(2026, 10, 25)}, None, {"reason": "This slot is past its 36 h entry window. Move the stage into the next 3 days before floor entry."})
    assert expired["reason"] == "Its planner slot was more than 36 h old when the run was entered."
    assert classify({"date": date(2026, 10, 25)}, None, None)["reason"] == "The stage had no planner slot when this run was entered."
    assert classify({"date": date(2026, 10, 25)}, None, None)["status"] == "UNPLANNED"


@pytest.mark.parametrize("written,expected", [("A", "SHIFT_A"), ("shift a", "SHIFT_A"), ("Shift-B", "SHIFT_B"), ("SHIFT_B", "SHIFT_B"), ("", None), (None, None)])
def test_shift_written_any_way_is_stored_as_shift_a_or_b(written, expected):
    assert canonical_shift(written) == expected
    assert StageOutputPayload(shift_code=written).shift_code == expected


def test_unknown_shift_gets_a_plain_message():
    with pytest.raises(ValueError, match="Choose Shift A or Shift B"):
        canonical_shift("G")
