"""Client 30 Oct 2026, planner board: winding load in metres (and pcs), never pcs counted as metres; a card
without a tube length is "length missing"; drop advisories in plain words with machine codes; a flag never
stops the drop."""
import uuid
from datetime import date, datetime
from types import SimpleNamespace

from src.routers import planning
from src.routers.planning import (
    _feasibility_warning,
    _lane_counts,
    _lane_load,
    _validate_machine_compatibility,
    _winder_capacity_meters_for_qty,
    _winder_metres_or_none,
    _winder_override_warning,
)

PLANT = "00000000-0000-0000-0000-0000000000a1"
SPEC_150 = {"length_min_mm": 149.8, "length_max_mm": 150.2, "selected_bamboo_length_mm": 1540, "pcs_per_bamboo": 10}
NO_LENGTH = {"id_min_mm": 76, "id_max_mm": 76.2}


def _machine(**extra):
    return {"plant_id": PLANT, "is_active": True, "department": "WINDER", "status": "UP", "code": "W-03", "name": "Winder 3",
            "id_min_mm": 40, "id_max_mm": 120, "od_min_mm": 40, "od_max_mm": 140, "length_min_mm": 100, "length_max_mm": 1200, **extra}


def test_winding_metres_come_from_the_spec_and_never_from_pcs():
    assert _winder_metres_or_none(600, SPEC_150) == 92.4  # 60 bamboos x 1.54 m
    assert _winder_metres_or_none(600, NO_LENGTH) is None
    assert _winder_capacity_meters_for_qty(600, NO_LENGTH) == 0.0  # was 600 "m" (pcs read as metres)


def test_lane_shows_metres_pcs_and_length_missing_cards():
    jobs = [
        SimpleNamespace(job_card_id=uuid.uuid4(), planned_qty=600.0, required_capacity=92.4, length_missing=False),
        SimpleNamespace(job_card_id=uuid.uuid4(), planned_qty=300.0, required_capacity=None, length_missing=True),
    ]
    assert _lane_load("WINDER", "METERS_PER_DAY", jobs, {}) == 92.4
    assert _lane_counts(jobs) == {"planned_pcs": 900.0, "cards": 2, "length_missing_cards": 1, "length_missing_pcs": 300.0}


def test_queue_item_marks_a_spec_without_length():
    stage_row = SimpleNamespace(id=uuid.uuid4(), stage_type="WINDER", status="QUEUED", planned_start=None, planned_end=None)
    segment = SimpleNamespace(id=uuid.uuid4(), planned_qty=300.0, required_capacity=300.0, status="QUEUED", segment_no=1, split_source="NONE",
                              split_parent_segment_id=None, sequence_no=1, machine_id=None, plan_date=None, shift_code=None)
    card = SimpleNamespace(id=uuid.uuid4(), job_card_no="26/10/99", is_emergency=False, missed_slot_open=False, missed_slot_count=0, split_kind=None,
                           sales_order_id=uuid.uuid4(), sales_order_line_id=None, release_lot_id=None, planned_qty=300.0, current_stage="WINDER", product_code="X",
                           parchment_color=None, released_qty=300.0, assigned_winder_machine_id=None, created_at=datetime(2026, 10, 30, 10, 0), material_plan_snapshot={}, spec_snapshot=dict(NO_LENGTH))
    item = planning._queue_item_from_stage_row(segment, card, stage_row, None)
    assert item.length_missing is True and item.winding_m is None and item.required_capacity is None
    card.spec_snapshot = dict(SPEC_150)
    item = planning._queue_item_from_stage_row(segment, card, stage_row, None)
    assert item.length_missing is False and item.winding_m == 46.2


def test_other_winder_advisory_names_both_machines_never_id_fragments():
    release, planned = uuid.uuid4(), uuid.uuid4()
    card = SimpleNamespace(assigned_winder_machine_id=release)
    text = _winder_override_warning(card, planned, release_machine={"code": "W-01", "name": "Winder 1"}, planned_machine={"code": "W-03", "name": "Winder 3"})
    assert text == "Released for W-01 (Winder 1), planned on W-03 (Winder 3)."
    assert str(release)[:8] not in text and str(planned)[:8] not in text
    assert _winder_override_warning(card, release) is None
    assert _winder_override_warning(SimpleNamespace(assigned_winder_machine_id=None), planned, planned_machine={"code": "W-03"}) == "No winder was chosen at release; planned on W-03."


def test_capability_advisory_is_plain_words_and_never_blocks_any_stage():
    spec = {"id_min_mm": 76, "id_max_mm": 76.2, "od_min_mm": 81, "od_max_mm": 81, "length_min_mm": 1500, "length_max_mm": 1500}
    text = _validate_machine_compatibility(_machine(), "WINDER", spec, PLANT)
    assert text == "W-03 makes 100–1,200 mm tubes; this spec needs 1,500 mm. Check the setup before running."
    for stage in ("OVEN", "PROCESS"):
        assert "W-03 makes 100–1,200 mm tubes" in _validate_machine_compatibility(_machine(department=stage), stage, spec, PLANT)


def test_capacity_warning_names_the_slot_in_plain_words():
    text = _feasibility_warning(plan_date=date(2026, 11, 2), closed_dates=set(), capacity=6500, capacity_unit="METERS_PER_DAY",
                                planned_total=7200, stage="WINDER", machine_label="W-01", shift_code="SHIFT_B")
    assert text.startswith("W-01 · 02 Nov · Shift B is over capacity: 7,200 m planned on 6,500 m (exceeds by 700 m).")
