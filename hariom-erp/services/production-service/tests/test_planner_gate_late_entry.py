from datetime import date, datetime
from types import SimpleNamespace

from src.routers.planning import _planner_gate_context


def _segment(plan_date, shift_code="SHIFT_B"):
    return SimpleNamespace(machine_id="w1", plan_date=plan_date, shift_code=shift_code, status="ASSIGNED")


def test_last_nights_shift_can_be_entered_next_morning():
    gate = _planner_gate_context(current_stage="WINDER", active_segment=_segment(date(2026, 9, 26)),
        today=date(2026, 9, 27), now_local=datetime(2026, 9, 27, 9, 30))
    assert gate["planner_gate_ready"] is True


def test_slot_stays_enterable_until_36_hours_after_the_shift_ends():
    # Shift A on the 25th ends 20:00; deadline 27th 08:00
    segment = _segment(date(2026, 9, 25), "SHIFT_A")
    assert _planner_gate_context(current_stage="OVEN", active_segment=segment, today=date(2026, 9, 27), now_local=datetime(2026, 9, 27, 7, 59))["planner_gate_ready"] is True
    late = _planner_gate_context(current_stage="OVEN", active_segment=segment, today=date(2026, 9, 27), now_local=datetime(2026, 9, 27, 8, 0))
    assert late["planner_gate_ready"] is False
    assert "36 h" in late["planner_gate_reason"]


def test_future_slot_outside_three_days_still_blocked():
    gate = _planner_gate_context(current_stage="WINDER", active_segment=_segment(date(2026, 10, 3)), today=date(2026, 9, 27))
    assert gate["planner_gate_ready"] is False


def test_requeued_missed_slot_stays_open_for_late_entry():
    queued = SimpleNamespace(machine_id=None, plan_date=None, shift_code=None, status="QUEUED")
    slot = {"stage": "WINDER", "machine_id": "w1", "plan_date": "2026-09-20", "shift_code": "SHIFT_A"}
    gate = _planner_gate_context(current_stage="WINDER", active_segment=queued, today=date(2026, 9, 27), missed_slot=slot)
    assert gate["planner_gate_ready"] is True
    assert gate["late_entry_slot"]["plan_date"] == "2026-09-20"
    # a slot missed on another stage does not open this one
    other = _planner_gate_context(current_stage="OVEN", active_segment=queued, today=date(2026, 9, 27), missed_slot=slot)
    assert other["planner_gate_ready"] is False
