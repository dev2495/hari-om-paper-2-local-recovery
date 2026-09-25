"""Stale planner slots must stay visible on the planning board.

A segment slotted on a past date matches neither the live board date nor the
"no slot" filter, so before this fix it disappeared from both the open queue
and the canvas while the job card showed "planner slot is stale".
"""
import os
import uuid
from datetime import date, datetime, timedelta
from unittest.mock import patch

import pytest

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

from src.database import Base, SessionLocal, engine
from src.models import JobCard, JobCardStage, JobCardStageSegment, SalesOrder, PLANT_A_UUID
from src.routers.planning import PLANT_TIMEZONE, _build_stage_board_view

SCOPE = {'scope_all': False, 'selected_plant_id': str(PLANT_A_UUID), 'allowed_plants': [str(PLANT_A_UUID)]}


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    conn = engine.connect()
    transaction = conn.begin()
    session = SessionLocal(bind=conn, join_transaction_mode='create_savepoint')
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        conn.close()


def _winder_card(db, *, machine_id, plan_date, status='ASSIGNED'):
    order = SalesOrder(customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=500, due_date=date.today())
    db.add(order)
    db.flush()
    job = JobCard(plant_id=PLANT_A_UUID, sales_order_id=order.id, spec_id=order.spec_id, planned_qty=500,
                  released_qty=500, status='PLANNED', current_stage='WINDER', routing_snapshot={'stages': ['WINDER']})
    db.add(job)
    db.flush()
    db.add(JobCardStage(job_card_id=job.id, stage_type='WINDER', status=status, machine_id=machine_id,
                        shift_code='SHIFT_A' if machine_id else None, plan_date=plan_date))
    segment = JobCardStageSegment(plant_id=PLANT_A_UUID, job_card_id=job.id, stage_type='WINDER', machine_id=machine_id,
                                  shift_code='SHIFT_A' if machine_id else None, plan_date=plan_date,
                                  planned_qty=500, status=status)
    db.add(segment)
    db.commit()
    return job, segment


def _board(db, plan_date):
    machine = {'id': str(MACHINE), 'code': 'W-01', 'name': 'WINDER 1', 'department': 'WINDER', 'capacity_value': 6500}
    with patch('src.routers.planning._fetch_stage_machines', return_value=[machine]), \
         patch('src.routers.planning._fetch_plant_closed_dates', return_value=set()):
        view, _ = _build_stage_board_view(db=db, stage='WINDER', plan_date=plan_date, include_unscheduled=True,
                                          plant_scope=SCOPE, token='', plant_id=str(PLANT_A_UUID))
    return {lane.lane_id: lane for lane in view.lanes}


MACHINE = uuid.uuid4()


def test_stale_slot_returns_to_open_queue_with_its_old_date(db):
    today = datetime.now(PLANT_TIMEZONE).date()
    stale_job, _ = _winder_card(db, machine_id=MACHINE, plan_date=today - timedelta(days=1))
    fresh_job, _ = _winder_card(db, machine_id=MACHINE, plan_date=today)
    queued_job, _ = _winder_card(db, machine_id=None, plan_date=today, status='QUEUED')

    lanes = _board(db, today)
    queue = {job.job_card_id: job for job in lanes['WINDER:UNSCHEDULED'].jobs}
    shift_a = {job.job_card_id for job in lanes[f'WINDER:{MACHINE}:SHIFT_A'].jobs}

    assert stale_job.id in queue
    assert queue[stale_job.id].stale_slot is True
    assert queue[stale_job.id].stale_plan_date == today - timedelta(days=1)
    assert queued_job.id in queue and queue[queued_job.id].stale_slot is False
    assert fresh_job.id in shift_a and stale_job.id not in shift_a


def test_future_board_day_does_not_duplicate_todays_slot(db):
    today = datetime.now(PLANT_TIMEZONE).date()
    fresh_job, _ = _winder_card(db, machine_id=MACHINE, plan_date=today)
    lanes = _board(db, today + timedelta(days=1))
    all_jobs = {job.job_card_id for lane in lanes.values() for job in lane.jobs}
    assert fresh_job.id not in all_jobs


def test_completed_stale_segment_stays_off_the_board(db):
    today = datetime.now(PLANT_TIMEZONE).date()
    done_job, _ = _winder_card(db, machine_id=MACHINE, plan_date=today - timedelta(days=2), status='COMPLETED')
    lanes = _board(db, today)
    all_jobs = {job.job_card_id for lane in lanes.values() for job in lane.jobs}
    assert done_job.id not in all_jobs
