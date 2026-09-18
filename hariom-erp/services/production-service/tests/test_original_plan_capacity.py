"""Original PLAN-06/07/08 capacity, holiday, and oven-share procedures."""
from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

from src.routers.planning import (
    CLOSED_DATE_WARNING,
    MISSING_CAPACITY_POLICY_WARNING,
    STAGE_DEFAULT_CAPACITY_UNITS,
    _capacity_allocation_to_qty,
    _capacity_warning_message,
    _feasibility_warning,
    _future_stage_slots,
    _oven_bamboo_capacity_profile,
    _planned_load_for_capacity,
    _required_capacity_for_job,
)


class _EmptyQuery:
    def filter(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return []

    def first(self):
        return None


class _EmptySession:
    def query(self, *args, **kwargs):
        return _EmptyQuery()


def test_plan06_stage_units_convert_metres_batches_and_tubes():
    snapshot = {
        "length_min_mm": 115.0,
        "length_max_mm": 115.0,
        "bamboo_max_length": 1560,
        "cut_loss_mm": 40,
    }
    winder_meters = _planned_load_for_capacity(
        stage="WINDER",
        capacity_unit="METERS_PER_DAY",
        planned_qty=450.0,
        spec_snapshot=snapshot,
    )
    oven_batches = _planned_load_for_capacity(
        stage="OVEN",
        capacity_unit="BATCHES_PER_DAY",
        planned_qty=250.0,
        spec_snapshot=snapshot,
    )
    process_tubes = _planned_load_for_capacity(
        stage="PROCESS",
        capacity_unit="TUBES_PER_DAY",
        planned_qty=88.0,
        spec_snapshot=snapshot,
    )
    assert STAGE_DEFAULT_CAPACITY_UNITS["WINDER"] == "METERS_PER_DAY"
    assert STAGE_DEFAULT_CAPACITY_UNITS["OVEN"] == "BATCHES_PER_DAY"
    assert STAGE_DEFAULT_CAPACITY_UNITS["PROCESS"] == "TUBES_PER_DAY"
    assert winder_meters == _required_capacity_for_job(
        stage="WINDER", planned_qty=450.0, spec_snapshot=snapshot
    )
    assert oven_batches == 1.0
    assert process_tubes == 88.0
    assert winder_meters != 450.0


def test_plan06_missing_capacity_policy_is_not_labelled_feasible():
    warning = _capacity_warning_message(
        db=_EmptySession(),
        plant_id=uuid4(),
        stage="WINDER",
        machine_id=uuid4(),
        machine_capacity=0,
        use_resolved=True,
        resolved_capacity=None,
        resolved_unit=None,
    )
    assert warning == MISSING_CAPACITY_POLICY_WARNING
    assert "feasible" in warning


def test_plan07_closed_dates_are_skipped_and_horizon_remainder_stays_finite():
    start = date(2026, 1, 1)
    holiday = date(2026, 1, 1)
    slots = _future_stage_slots(start, "SHIFT_A", horizon_days=3, closed_dates={holiday})
    days = {day for day, _shift in slots}
    assert holiday not in days
    assert date(2026, 1, 2) in days
    assert date(2026, 1, 3) in days
    assert date(2026, 1, 4) not in days
    full = _future_stage_slots(start, "SHIFT_A", horizon_days=30)
    assert max(day for day, _shift in full) == start + timedelta(days=29)
    assert _feasibility_warning(
        plan_date=holiday,
        closed_dates={holiday},
        capacity=100.0,
        capacity_unit="METERS_PER_DAY",
        planned_total=10.0,
        stage="WINDER",
    ) == CLOSED_DATE_WARNING


def test_plan08_shared_oven_batch_capacity_cannot_be_overbooked():
    machine = {"capacity_value": 2.0, "batch_bamboo_capacity": 10.0}
    daily, unit = _oven_bamboo_capacity_profile("OVEN", machine)
    assert unit == "BAMBOOS_PER_DAY"
    assert daily == 20.0
    first_qty, first_load = _capacity_allocation_to_qty(
        "OVEN", "BATCHES_PER_DAY", {}, remaining_qty=120.0, available_capacity=2.0
    )
    second_qty, second_load = _capacity_allocation_to_qty(
        "OVEN", "BATCHES_PER_DAY", {}, remaining_qty=80.0, available_capacity=1.0
    )
    third_qty, third_load = _capacity_allocation_to_qty(
        "OVEN", "BATCHES_PER_DAY", {}, remaining_qty=40.0, available_capacity=0.0
    )
    assert first_qty == 120.0 and first_load == 1.0
    assert second_qty == 80.0 and second_load == 1.0
    assert third_qty == 0.0 and third_load == 0.0
    bamboo_left = _capacity_allocation_to_qty(
        "OVEN", "BAMBOOS_PER_DAY", {}, remaining_qty=100.0, available_capacity=0.0
    )
    assert bamboo_left == (0.0, 0.0)
