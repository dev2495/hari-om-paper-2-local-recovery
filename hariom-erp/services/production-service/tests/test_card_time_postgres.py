"""Late job-card entry against an isolated PostgreSQL DB.

The paper card is filled on the floor; the supervisor types it in a day later.
Stage actuals must follow the card's Start (A)/End (B), not the typing time.
"""
import os
import uuid
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

from src.database import Base, SessionLocal, engine
from src.models import JobCard, JobCardStage, JobCardStageSegment, SalesOrder, PLANT_A_UUID
from src.routers.planning import capture_stage_output, list_stage_time_reconciliation
from src.schemas.planning import StageOutputPayload

IST = timezone(timedelta(hours=5, minutes=30))
USER = {'roles': ['PlantManager'], 'role': 'PlantManager', 'token': 'test', 'sub': 'supervisor-1'}
ROUTE = ['WINDER', 'OVEN', 'PROCESS', 'PACKING']


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


def _job_card(db):
    order = SalesOrder(customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=1000, due_date=date.today())
    db.add(order)
    db.flush()
    job = JobCard(
        plant_id=PLANT_A_UUID, sales_order_id=order.id, spec_id=order.spec_id, planned_qty=1000, released_qty=1000,
        status='IN_PROGRESS', current_stage='WINDER', routing_snapshot={'stages': ROUTE},
        created_at=datetime.utcnow() - timedelta(days=3),
    )
    db.add(job)
    db.flush()
    machine_id = uuid.uuid4()
    for stage in ROUTE:
        db.add(JobCardStage(job_card_id=job.id, stage_type=stage, status='ASSIGNED' if stage == 'WINDER' else 'PLANNED',
                            machine_id=machine_id, shift_code='SHIFT_A', plan_date=date.today() - timedelta(days=1)))
    db.add(JobCardStageSegment(plant_id=PLANT_A_UUID, job_card_id=job.id, stage_type='WINDER', machine_id=machine_id,
                               shift_code='SHIFT_A', planned_qty=1000, status='ASSIGNED'))
    db.commit()
    return job


def _post(db, job, **payload):
    with patch('src.routers.planning._fetch_machine', return_value={'capacity_value': 0}), \
         patch('src.routers.planning._validate_machine_compatibility'), \
         patch('src.routers.planning._record_physical_tool_usage', return_value=[]):
        return capture_stage_output(job.id, StageOutputPayload(**payload), db, str(PLANT_A_UUID), USER)


def test_late_winder_entry_keeps_card_times_and_is_reported(db):
    job = _job_card(db)
    yesterday = (datetime.now(IST) - timedelta(days=1)).replace(hour=7, minute=5, second=0, microsecond=0)
    start, end = yesterday, yesterday + timedelta(hours=7, minutes=35)

    # Draft saved without times must not pin the start to the typing time.
    _post(db, job, stage='WINDER', save_mode='draft', shift_code='SHIFT_B', entry_snapshot={'operator_name': 'Ramesh'})
    with pytest.raises(HTTPException) as missing:
        _post(db, job, stage='WINDER', save_mode='complete', output_qty=190, reel_issue_ids=[uuid.uuid4()])
    assert missing.value.status_code == 400
    db.rollback()  # a rejected request never commits

    response = _post(
        db, job, stage='WINDER', save_mode='complete', output_qty=190, scrap_qty=10, input_qty=200,
        reel_issue_ids=[uuid.uuid4()], shift_code='SHIFT_B',
        start_time=start.isoformat(), end_time=end.isoformat(),
        entry_snapshot={'operator_name': 'Ramesh', 'start_time': start.strftime('%Y-%m-%dT%H:%M'), 'end_time': end.strftime('%Y-%m-%dT%H:%M')},
    )
    assert any('reconciliation' in warning for warning in response.warnings)

    stage = db.query(JobCardStage).filter_by(job_card_id=job.id, stage_type='WINDER').one()
    segment = db.query(JobCardStageSegment).filter_by(job_card_id=job.id, stage_type='WINDER').one()
    expected_start = start.astimezone(timezone.utc).replace(tzinfo=None)
    expected_end = end.astimezone(timezone.utc).replace(tzinfo=None)
    assert segment.started_at == expected_start
    assert segment.completed_at == expected_end
    assert stage.actual_start == expected_start and stage.actual_end == expected_end
    assert stage.entered_at > expected_end + timedelta(hours=6)
    record = stage.actuals_snapshot['time_reconciliation']
    assert record['time_source'] == 'CARD' and record['late_entry'] is True
    assert record['cycle_time_minutes'] == 455.0
    assert len(stage.actuals_snapshot['time_reconciliation_log']) == 2  # draft + complete
    assert stage.entry_snapshot['start_time'] == start.strftime('%Y-%m-%dT%H:%M')  # literal card text kept
    assert stage.entry_snapshot['shift_code'] == 'SHIFT_B'

    scope = {'scope_all': False, 'selected_plant_id': str(PLANT_A_UUID), 'allowed_plants': [str(PLANT_A_UUID)]}
    report = list_stage_time_reconciliation(
        date_from=None, date_to=None, stage='WINDER', late_only=True, limit=50, offset=0,
        db=db, plant_scope=scope, current_user=USER,
    )
    row = next(item for item in report['items'] if item['job_card_id'] == str(job.id))
    assert row['late_entry'] is True and row['time_source'] == 'CARD'
    assert row['card_shift_code'] == 'SHIFT_B' and row['cycle_time_minutes'] == 455.0


def test_oven_completion_accepts_supervisor_ui_keys(db):
    job = _job_card(db)
    start = (datetime.now(IST) - timedelta(hours=8)).replace(second=0, microsecond=0)
    _post(db, job, stage='WINDER', save_mode='complete', output_qty=200, input_qty=200, reel_issue_ids=[uuid.uuid4()],
          start_time=(start - timedelta(hours=8)).isoformat(), end_time=(start - timedelta(hours=1)).isoformat())
    response = _post(
        db, job, stage='OVEN', save_mode='complete', output_qty=198, input_qty=200,
        start_time=start.isoformat(), end_time=(start + timedelta(hours=5, minutes=30)).isoformat(),
        entry_snapshot={'bamboo_count_in': '200', 'pre_oven_weight_kg': '260', 'post_oven_weight_kg': '222',
                        'moisture_before': '21', 'moisture_after': '7'},
    )
    assert response.stage_status == 'COMPLETED'
    assert response.remaining_open_segments == 0
    assert response.current_stage == 'PROCESS'
    oven = db.query(JobCardStage).filter_by(job_card_id=job.id, stage_type='OVEN').one()
    assert oven.entry_snapshot['pre_weight'] == '260' and oven.entry_snapshot['post_moisture'] == '7'


def test_completion_hands_over_to_unplanned_next_stage(db):
    job = _job_card(db)
    start = (datetime.now(IST) - timedelta(hours=3)).replace(second=0, microsecond=0)
    response = _post(db, job, stage='WINDER', save_mode='complete', output_qty=200, input_qty=200, reel_issue_ids=[uuid.uuid4()],
                     start_time=start.isoformat(), end_time=(start + timedelta(hours=2)).isoformat())
    assert response.remaining_open_segments == 0
    oven_segments = db.query(JobCardStageSegment).filter_by(job_card_id=job.id, stage_type='OVEN').all()
    assert len(oven_segments) == 1 and oven_segments[0].status != 'COMPLETED'
    oven = db.query(JobCardStage).filter_by(job_card_id=job.id, stage_type='OVEN').one()
    assert oven.input_qty == 200


def test_future_card_time_is_rejected(db):
    job = _job_card(db)
    future = datetime.now(IST) + timedelta(hours=2)
    with pytest.raises(HTTPException) as exc:
        _post(db, job, stage='WINDER', save_mode='complete', output_qty=100, reel_issue_ids=[uuid.uuid4()],
              start_time=(future - timedelta(hours=1)).isoformat(), end_time=future.isoformat())
    assert exc.value.status_code == 400


def test_dispatch_history_feeds_job_card_print(db):
    from src.models import Dispatch
    from src.routers.planning import _job_card_dispatch_history

    job = _job_card(db)
    db.add(Dispatch(job_card_id=job.id, status='SEALED', dispatch_snapshot={'dispatch_qty': 600, 'vehicle_no': 'GJ05AB1234'},
                    created_at=datetime.utcnow() - timedelta(days=1)))
    db.add(Dispatch(job_card_id=job.id, status='SEALED', dispatch_snapshot={'qty': 400}))
    db.add(Dispatch(job_card_id=job.id, status='DRAFT', dispatch_snapshot={'dispatch_qty': 50}))
    db.commit()
    history = _job_card_dispatch_history(db, job)
    assert [row['dispatch_qty'] for row in history] == [600, 400]
    assert [row['pending_qty'] for row in history] == [400, 0]
    assert history[0]['vehicle_no'] == 'GJ05AB1234' and history[0]['dispatch_date']
