"""Job card floor entry and planning edge cases against an isolated PostgreSQL DB.

Covers the supervisor screen's real sequences: one stage at a time, a whole card entered
at once in route order, out-of-order and over-tolerance entries, reschedule with capacity
auto-split, force close / cancel, missed slot re-queue with late entry, emergency insert,
amend and split. Cross-service calls (machines, sales) are stubbed.
"""
import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

from src.database import Base, SessionLocal, engine
from src.job_card_numbering import allocate_job_card_no
from src.models import AuditEvent, JobCard, JobCardStage, JobCardStageSegment, MachineStageCapacityProfile, SalesOrder, PLANT_A_UUID
from src.routers import lifecycle, missed_slots, planning
from src.schemas.planning import ReorderQueuePayload, StageOutputPayload

IST = timezone(timedelta(hours=5, minutes=30))
PLANT = str(PLANT_A_UUID)
SUPERVISOR = {'roles': ['PlantManager'], 'role': 'PlantManager', 'acting_role': 'PlantManager', 'token': 't', 'sub': 'supervisor-1'}
PLANNER = {'roles': ['Planner'], 'role': 'Planner', 'acting_role': 'Planner', 'token': 't', 'sub': 'planner-1'}
OWNER = {'roles': ['Owner'], 'role': 'Owner', 'acting_role': 'Owner', 'token': 't', 'sub': 'owner-1'}
OVEN_CARD = {'pre_weight': 3300, 'post_weight': 3010, 'pre_moisture': 12.5, 'post_moisture': 7.2}
ROUTE = ['WINDER', 'OVEN', 'PROCESS', 'PACKING']
SPEC = {'pcs_per_bamboo': 8, 'selected_bamboo_length_mm': 1200, 'customer_name': 'Flow Customer'}
BIG_WINDER, SMALL_WINDER, OVEN, LINE, PACK = (uuid.uuid4() for _ in range(5))


@pytest.fixture()
def db(monkeypatch):
    Base.metadata.create_all(engine)
    conn = engine.connect()
    transaction = conn.begin()
    session = SessionLocal(bind=conn, join_transaction_mode='create_savepoint')
    machines = {
        str(BIG_WINDER): {'id': str(BIG_WINDER), 'code': 'W-01', 'department': 'WINDER', 'status': 'UP', 'capacity_value': 0},
        str(SMALL_WINDER): {'id': str(SMALL_WINDER), 'code': 'W-02', 'department': 'WINDER', 'status': 'UP', 'capacity_value': 0},
        str(OVEN): {'id': str(OVEN), 'code': 'OV-1', 'department': 'OVEN', 'status': 'UP', 'capacity_value': 0},
        str(LINE): {'id': str(LINE), 'code': 'PL-1', 'department': 'PROCESS', 'status': 'UP', 'capacity_value': 0},
        str(PACK): {'id': str(PACK), 'code': 'PK-1', 'department': 'PACKING', 'status': 'UP', 'capacity_value': 0},
    }
    fetch = lambda machine_id, *args, **kwargs: {**machines.get(str(machine_id), machines[str(BIG_WINDER)]), 'plant_id': PLANT}
    sales_calls = []

    def fake_sales(path, body, token, plant_id):
        sales_calls.append((path, body))
        if path.endswith('/reallocate-carry-forward'):
            return {'release_lot_id': body.get('release_lot_id'), 'release_qty': body.get('gap_qty')}
        if path.endswith('/amend'):
            return {'parchment_color': body.get('parchment_color')}
        return {}

    monkeypatch.setattr(planning, '_fetch_machine', fetch)
    monkeypatch.setattr(lifecycle, '_fetch_machine', fetch, raising=False)
    monkeypatch.setattr(planning, '_validate_machine_compatibility', lambda *args, **kwargs: None)
    monkeypatch.setattr(planning, '_record_physical_tool_usage', lambda *args, **kwargs: [])
    monkeypatch.setattr(planning, '_fetch_plant_closed_dates', lambda *args, **kwargs: set())
    monkeypatch.setattr(lifecycle, '_fetch_plant_closed_dates', lambda *args, **kwargs: set(), raising=False)
    monkeypatch.setattr(planning, '_winder_override_warning', lambda *args, **kwargs: None)
    monkeypatch.setattr(planning, '_fetch_paper_catalog_for_theory', lambda *args, **kwargs: {})
    monkeypatch.setattr(planning, '_fetch_inventory_item_catalog_for_theory', lambda *args, **kwargs: [])
    monkeypatch.setattr(lifecycle, '_sales_call', fake_sales)
    monkeypatch.setattr(lifecycle, '_rebuild_snapshots', lambda job, **kwargs: None)
    session.sales_calls = sales_calls
    session.add_all([
        MachineStageCapacityProfile(plant_id=PLANT_A_UUID, machine_id=BIG_WINDER, stage_type='WINDER', capacity_unit='METERS_PER_DAY', capacity_value=100000.0, active=True),
        MachineStageCapacityProfile(plant_id=PLANT_A_UUID, machine_id=SMALL_WINDER, stage_type='WINDER', capacity_unit='METERS_PER_DAY', capacity_value=600.0, active=True),
    ])
    session.flush()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        conn.close()


def _card(db, qty=2000, color='BLUE'):
    order = SalesOrder(plant_id=PLANT_A_UUID, customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=qty * 4, due_date=date.today() + timedelta(days=9))
    db.add(order)
    db.flush()
    job = JobCard(plant_id=PLANT_A_UUID, sales_order_id=order.id, sales_order_line_id=uuid.uuid4(), release_lot_id=uuid.uuid4(),
                  spec_id=order.spec_id, spec_snapshot=dict(SPEC), routing_snapshot={'stages': ROUTE, 'first_stage': 'WINDER'},
                  material_plan_snapshot={}, released_qty=qty, planned_qty=qty, status='PLANNED', current_stage='WINDER',
                  parchment_color=color, job_card_no=allocate_job_card_no(db))
    db.add(job)
    db.flush()
    planning._ensure_job_card_stages(db=db, job_card=job, routing_stages=ROUTE, first_stage='WINDER')
    for row in planning._open_stage_segments(db, job.id, 'WINDER'):
        row.machine_id = None; row.shift_code = None; row.status = 'QUEUED'; row.planned_qty = qty
    db.flush()
    return job


def _schedule(db, job, machine=BIG_WINDER, day=None, shift='SHIFT_A', stage='WINDER', seq=1):
    return planning.reorder_stage_queue(
        payload=ReorderQueuePayload(job_card_id=job.id, stage=stage, machine_id=machine, sequence_no=seq,
                                    plan_date=day or date.today(), shift_code=shift),
        db=db, plant_id=PLANT, current_user=PLANNER)


def _preassign(db, job, stage, machine, day=None, shift='SHIFT_A'):
    """Planner placed a later stage on the board before the card reached it."""
    return _schedule(db, job, machine=machine, day=day, shift=shift, stage=stage)


def _times(hours_ago_start, hours_ago_end):
    now = datetime.now(IST).replace(second=0, microsecond=0)
    start, end = now - timedelta(hours=hours_ago_start), now - timedelta(hours=hours_ago_end)
    return {'start_time': start.isoformat(), 'end_time': end.isoformat()}


def _enter(db, job, stage, output, user=SUPERVISOR, **extra):
    payload = {'stage': stage, 'save_mode': 'complete', 'output_qty': output, 'shift_code': 'SHIFT_A', **_times(9, 2)}
    if stage == 'WINDER':
        payload.setdefault('reel_issue_ids', [uuid.uuid4()])
    if stage == 'OVEN':
        payload.setdefault('entry_snapshot', dict(OVEN_CARD))
        payload.update(_times(8, 2.5))  # an oven batch runs 5-6 h
    payload.update(extra)
    return planning.capture_stage_output(job.id, StageOutputPayload(**payload), db, PLANT, user)


def _stage(db, job, stage):
    return db.query(JobCardStage).filter_by(job_card_id=job.id, stage_type=stage).one()


def _audits(db, job):
    return [row.action for row in db.query(AuditEvent).filter(AuditEvent.job_card_id == job.id).order_by(AuditEvent.event_ts).all()]


# ---- floor entry ------------------------------------------------------------------------

def test_card_numbers_follow_the_monthly_series(db):
    first, second = _card(db), _card(db)
    prefix = datetime.now().strftime('%y/%m/')
    assert first.job_card_no.startswith(prefix) and second.job_card_no.startswith(prefix)
    assert int(second.job_card_no[-2:]) == int(first.job_card_no[-2:]) + 1


def test_single_stage_entry_completes_only_that_stage(db):
    job = _card(db)  # 2000 pcs / 8 = 250 bamboos
    _schedule(db, job)
    _enter(db, job, 'WINDER', 250, input_qty=252, scrap_qty=2)
    db.refresh(job)
    assert _stage(db, job, 'WINDER').status == 'COMPLETED'
    assert job.current_stage == 'OVEN' and job.status != 'COMPLETED'
    assert _stage(db, job, 'OVEN').status != 'COMPLETED'
    assert _stage(db, job, 'OVEN').input_qty == 250  # handover carries winder output


def test_whole_card_entered_at_once_in_route_order_completes_the_job(db):
    job = _card(db)
    _schedule(db, job)
    _preassign(db, job, 'OVEN', OVEN)
    _preassign(db, job, 'PROCESS', LINE)
    _preassign(db, job, 'PACKING', PACK)
    _enter(db, job, 'WINDER', 250, input_qty=250)
    _enter(db, job, 'OVEN', 248, input_qty=250)
    _enter(db, job, 'PROCESS', 1980, scrap_qty=4)
    _enter(db, job, 'PACKING', 1980)  # this route has no QC stage, so packing closes the card
    db.refresh(job)
    assert [(_stage(db, job, stage).status) for stage in ROUTE] == ['COMPLETED'] * 4
    assert job.current_stage == 'DONE' and job.status == 'COMPLETED'


def test_later_stage_cannot_be_completed_before_the_earlier_one(db):
    job = _card(db)
    _schedule(db, job)
    _preassign(db, job, 'OVEN', OVEN)
    with pytest.raises(HTTPException) as error:
        _enter(db, job, 'OVEN', 200, input_qty=200)
    assert error.value.status_code in (400, 409)
    assert 'WINDER' in str(error.value.detail)


def test_completed_stage_cannot_be_entered_twice(db):
    job = _card(db)
    _schedule(db, job)
    _enter(db, job, 'WINDER', 250)
    with pytest.raises(HTTPException) as error:
        _enter(db, job, 'WINDER', 10)
    assert error.value.status_code == 400 and 'Duplicate' in str(error.value.detail)


def test_winder_output_allows_ten_percent_over_plan_and_no_more(db):
    job = _card(db)
    _schedule(db, job)
    with pytest.raises(HTTPException) as error:
        _enter(db, job, 'WINDER', 276)  # 250 planned bamboos + 10% = 275
    assert error.value.status_code in (400, 409, 422)
    db.rollback()
    _enter(db, job, 'WINDER', 275)
    assert _stage(db, job, 'WINDER').status == 'COMPLETED'


def test_winder_completion_needs_reel_issues_or_a_reason(db):
    job = _card(db)
    _schedule(db, job)
    with pytest.raises(HTTPException) as error:
        _enter(db, job, 'WINDER', 250, reel_issue_ids=[])
    assert 'reel' in str(error.value.detail).lower()
    db.rollback()
    _enter(db, job, 'WINDER', 250, reel_issue_ids=[], override_reason='Reels issued on paper slip, linking later')
    assert _stage(db, job, 'WINDER').status == 'COMPLETED'


def test_running_entries_accumulate_and_oven_never_passes_winder(db):
    job = _card(db)
    _schedule(db, job)
    lifecycle.add_running_entry(job.id, lifecycle.RunningEntryPayload(stage='WINDER', qty=120), db, PLANT, SUPERVISOR)
    lifecycle.add_running_entry(job.id, lifecycle.RunningEntryPayload(stage='OVEN', qty=100), db, PLANT, SUPERVISOR)
    with pytest.raises(HTTPException) as error:
        lifecycle.add_running_entry(job.id, lifecycle.RunningEntryPayload(stage='OVEN', qty=30), db, PLANT, SUPERVISOR)
    assert error.value.status_code in (400, 409, 422)


# ---- planning: reschedule, split, emergency ---------------------------------------------

def test_reschedule_onto_a_small_winder_auto_splits_across_shifts(db):
    job = _card(db, qty=8000)  # 1000 bamboos x 1.2 m = 1200 m; the small winder takes 600 m a day
    _schedule(db, job, machine=SMALL_WINDER, day=date.today() + timedelta(days=1))
    segments = db.query(JobCardStageSegment).filter_by(job_card_id=job.id, stage_type='WINDER').filter(
        JobCardStageSegment.status.notin_(['CANCELLED'])).order_by(JobCardStageSegment.plan_date, JobCardStageSegment.shift_code).all()
    assert len(segments) >= 2
    assert round(sum(float(row.planned_qty or 0) for row in segments)) == 8000
    assert all(row.machine_id == SMALL_WINDER for row in segments)


def test_moving_to_another_winder_than_released_is_allowed_and_audited(db, monkeypatch):
    job = _card(db)
    monkeypatch.setattr(planning, '_winder_override_warning', lambda card, machine_id: 'Released for W-01; planned on W-02')
    _schedule(db, job, machine=SMALL_WINDER)
    assert 'winder_override' in _audits(db, job)


def test_emergency_insert_takes_the_slot_and_bumps_the_others(db):
    tomorrow = date.today() + timedelta(days=1)
    first, second, urgent = _card(db, 1500), _card(db, 1200), _card(db, 2000)
    _schedule(db, first, day=tomorrow)
    _schedule(db, second, day=tomorrow, seq=2)
    result = lifecycle.emergency_insert(lifecycle.EmergencyPayload(job_card_id=urgent.id, machine_id=BIG_WINDER, plan_date=tomorrow,
                                        shift_code='SHIFT_A', reason='Customer line down'), db, PLANT, PLANNER)
    segment = db.query(JobCardStageSegment).filter_by(job_card_id=urgent.id, stage_type='WINDER').filter(JobCardStageSegment.status != 'CANCELLED').one()
    assert segment.sequence_no == 1 and segment.plan_date == tomorrow
    assert round(float(segment.planned_qty)) == 2000  # never split
    db.refresh(urgent)
    assert urgent.is_emergency is True
    assert isinstance(result.get('bumped'), list)


def test_amend_only_while_queued(db):
    job = _card(db)
    changed = lifecycle.amend_job_card(job.id, lifecycle.AmendPayload(planned_qty=2400, parchment_color='RED', reason='Customer revised'), db, PLANT, PLANNER)
    assert changed['planned_qty'] == 2400 and changed['parchment_color'] == 'RED'
    _schedule(db, job)
    with pytest.raises(HTTPException) as error:
        lifecycle.amend_job_card(job.id, lifecycle.AmendPayload(planned_qty=100), db, PLANT, PLANNER)
    assert error.value.status_code in (400, 409)


def test_manual_split_creates_an_a_suffixed_card(db):
    job = _card(db, qty=3000)
    result = lifecycle.split_job_card(job.id, lifecycle.SplitPayload(qty=1000, reason='Two winders'), db, PLANT, PLANNER)
    child = db.get(JobCard, uuid.UUID(str(result.get('child_job_card_id') or result.get('child', {}).get('id'))))
    assert child.job_card_no == f'{job.job_card_no}-A'
    db.refresh(job)
    assert round(float(child.planned_qty)) == 1000 and round(float(job.planned_qty)) == 2000


# ---- stop / cancel ----------------------------------------------------------------------

def test_force_close_mid_run_returns_the_balance_to_the_order(db):
    job = _card(db)  # 2000 pcs
    _schedule(db, job)
    lifecycle.add_running_entry(job.id, lifecycle.RunningEntryPayload(stage='WINDER', qty=100), db, PLANT, SUPERVISOR)  # 800 pcs
    lifecycle.force_close_job_card(job.id, lifecycle.ForceClosePayload(reason='Customer cut the order'), db, PLANT, PLANNER)
    db.refresh(job)
    assert job.close_mode and round(float(job.returned_qty)) == 1200
    assert any(path.endswith('/return-balance') for path, _ in db.sales_calls)
    with pytest.raises(HTTPException):
        _enter(db, job, 'WINDER', 10)


def test_force_close_before_any_output_cancels_the_card(db):
    job = _card(db)
    _schedule(db, job)
    lifecycle.force_close_job_card(job.id, lifecycle.ForceClosePayload(reason='Released twice by mistake'), db, PLANT, PLANNER)
    db.refresh(job)
    assert job.status == 'CANCELLED' and round(float(job.returned_qty)) == 2000


# ---- missed slot + late entry -----------------------------------------------------------

def test_missed_slot_requeues_and_a_late_entry_restores_it(db):
    job = _card(db)
    ran_on = date.today() - timedelta(days=3)
    _schedule(db, job, day=date.today())
    for row in db.query(JobCardStageSegment).filter_by(job_card_id=job.id, stage_type='WINDER').all():
        row.plan_date = ran_on
    db.flush()
    moved = missed_slots.sweep_missed_slots(db, PLANT_A_UUID)
    assert any(str(item.get('job_card_id')) == str(job.id) for item in moved)
    db.refresh(job)
    assert job.missed_slot_open is True and job.missed_slot_count == 1
    segment = db.query(JobCardStageSegment).filter_by(job_card_id=job.id, stage_type='WINDER').filter(JobCardStageSegment.status != 'CANCELLED').one()
    assert segment.machine_id is None and segment.status == 'QUEUED'

    gate = planning._planner_gate_context(current_stage='WINDER', active_segment=segment, missed_slot=job.last_missed_slot)
    assert gate['planner_gate_ready'] is True  # the entry screen stays open for the late card

    _enter(db, job, 'WINDER', 250)
    db.refresh(job)
    assert job.missed_slot_open is False and job.current_stage == 'OVEN'
    restored = db.query(JobCardStageSegment).filter_by(job_card_id=job.id, stage_type='WINDER').filter(JobCardStageSegment.status != 'CANCELLED').one()
    assert restored.machine_id == BIG_WINDER and restored.plan_date == ran_on
    assert {'missed_slot_requeued', 'missed_slot_late_entry'} <= set(_audits(db, job))
