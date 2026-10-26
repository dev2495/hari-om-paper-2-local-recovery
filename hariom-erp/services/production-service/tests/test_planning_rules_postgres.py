"""Planning is only the plan (client 2026-10-26), against an isolated PostgreSQL DB.

Oven/Process open for planning only after the stage before has a slot; several cards placed at once are
all-or-nothing; the 36 h rule returns only expired slots; an old-form stage close closes every part of a
split plan; saved planner views; and the overview matches floor runs to slots by date and shift.
"""
import os
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

from src.models import JobCardStageSegment, PLANT_A_UUID
from src.routers import missed_slots, planning, planning_overview
from src.schemas.planning import BoardMovePayload
from tests.test_job_card_entry_flows_postgres import (  # noqa: F401  (db is a fixture)
    BIG_WINDER, IST, LINE, OVEN, OWNER, PLANNER, PLANT, SMALL_WINDER, SUPERVISOR, _card, _enter, _schedule, _stage, db,
)

SCOPE = {'scope_all': False, 'selected_plant_id': PLANT, 'allowed_plants': [PLANT]}


def _segments(db, job, stage):
    return db.query(JobCardStageSegment).filter_by(job_card_id=job.id, stage_type=stage).filter(JobCardStageSegment.status != 'CANCELLED').order_by(JobCardStageSegment.plan_date).all()


def test_oven_opens_for_planning_only_after_winding_has_a_slot(db):
    job = _card(db)
    assert planning._planning_locks(db, [job.id], 'OVEN') == {job.id: 'WINDER'}
    with pytest.raises(HTTPException) as refused:
        _schedule(db, job, machine=OVEN, stage='OVEN')
    assert refused.value.status_code == 409 and 'Plan Winding' in refused.value.detail
    assert planning._planning_locks(db, [job.id], 'PROCESS') == {job.id: 'OVEN'}
    _schedule(db, job)
    assert planning._planning_locks(db, [job.id], 'OVEN') == {}
    _schedule(db, job, machine=OVEN, stage='OVEN', shift='SHIFT_B')
    assert planning._planning_locks(db, [job.id], 'PROCESS') == {}


def test_several_cards_placed_at_once_are_all_or_nothing(db):
    first, second = _card(db), _card(db)
    db.commit()  # the cards exist before anyone plans them (a failed move must not undo them)
    moves = [BoardMovePayload(job_card_id=first.id, stage='WINDER', machine_id=BIG_WINDER, sequence_no=1, plan_date=date.today(), shift_code='SHIFT_A'),
             BoardMovePayload(job_card_id=second.id, stage='OVEN', machine_id=OVEN, sequence_no=1, plan_date=date.today(), shift_code='SHIFT_B')]
    with pytest.raises(HTTPException) as refused:
        planning_overview.move_many_planning_cards(planning_overview.BulkMovePayload(moves=moves), db, PLANT, PLANNER)
    assert refused.value.detail.endswith('Nothing was moved.') and second.job_card_no in refused.value.detail
    assert all(row.machine_id is None for row in _segments(db, first, 'WINDER'))
    moves[1] = BoardMovePayload(job_card_id=second.id, stage='WINDER', machine_id=BIG_WINDER, sequence_no=2, plan_date=date.today(), shift_code='SHIFT_A')
    result = planning_overview.move_many_planning_cards(planning_overview.BulkMovePayload(moves=moves), db, PLANT, PLANNER)
    assert result['moved'] == 2
    assert [row.machine_id for row in _segments(db, first, 'WINDER') + _segments(db, second, 'WINDER')] == [BIG_WINDER, BIG_WINDER]


def test_missed_slot_rule_returns_only_the_expired_part_of_a_split_plan(db):
    job = _card(db)
    _schedule(db, job, day=date.today() + timedelta(days=1))
    [only] = _segments(db, job, 'WINDER')
    planning.split_planning_segment(planning.StageSegmentSplitPayload(segment_id=only.id, stage='WINDER', primary_qty=1000), db, PLANT, PLANNER)
    early, late = _segments(db, job, 'WINDER')
    early.plan_date = date.today() - timedelta(days=3)
    db.flush()
    moved = missed_slots.sweep_missed_slots(db, PLANT_A_UUID)
    assert [item['job_card_id'] for item in moved] == [str(job.id)]
    statuses = {row.id: row.status for row in _segments(db, job, 'WINDER')}
    assert statuses[early.id] == 'QUEUED' and statuses[late.id] == 'ASSIGNED'


def test_old_form_close_closes_every_part_of_a_split_plan(db):
    job = _card(db)
    _schedule(db, job)
    [only] = _segments(db, job, 'WINDER')
    planning.split_planning_segment(planning.StageSegmentSplitPayload(segment_id=only.id, stage='WINDER', primary_qty=1000), db, PLANT, PLANNER)
    assert planning._plan_status(db, job, planning._open_stage_segments(db, job.id, 'WINDER'))['plan_status'] == 'SPLIT'
    _enter(db, job, 'WINDER', 250)
    db.refresh(job)
    assert job.current_stage == 'OVEN'
    assert {row.status for row in _segments(db, job, 'WINDER')} == {'COMPLETED'}


def test_overview_matches_a_run_to_its_slot_by_date_and_shift(db):
    job = _card(db)
    ran = (datetime.now(IST) - timedelta(hours=2)).date()
    _schedule(db, job, day=ran)
    _enter(db, job, 'WINDER', 250)
    built = planning_overview._build(db, SCOPE, ['WINDER'], ran - timedelta(days=1), ran + timedelta(days=1), '', PLANT)
    [slot] = [row for row in built['slots'] if row['job_card_id'] == str(job.id)]
    assert slot['planned_qty'] == 250 and slot['made_in_slot'] == 250 and slot['result'] == 'DONE'
    [run] = [row for row in built['runs'] if row['job_card_id'] == str(job.id)]
    assert run['match'] == 'ON_PLAN' and run['slot_id'] == slot['id']


def test_saved_views_are_personal_or_for_the_plant(db):
    other = {**PLANNER, 'sub': 'planner-2'}
    personal = planning_overview.create_planner_view(planning_overview.PlannerViewPayload(name='My due list', filters={'due': '3d'}), db, PLANT, PLANNER)
    shared = planning_overview.create_planner_view(planning_overview.PlannerViewPayload(name='Blue cards', scope='PLANT', stage='WINDER', filters={'colour': ['BLUE']}), db, PLANT, PLANNER)
    seen_by_other = {row['name'] for row in planning_overview.list_planner_views(None, db, PLANT, other)}
    assert seen_by_other == {'Blue cards'}
    with pytest.raises(HTTPException) as refused:
        planning_overview.update_planner_view(uuid.UUID(shared['id']), planning_overview.PlannerViewPayload(name='Mine now', scope='PLANT'), db, PLANT, other)
    assert refused.value.status_code == 403
    renamed = planning_overview.update_planner_view(uuid.UUID(shared['id']), planning_overview.PlannerViewPayload(name='Blue first', scope='PLANT', stage='WINDER'), db, PLANT, SUPERVISOR)
    assert renamed['name'] == 'Blue first'
    with pytest.raises(HTTPException):
        planning_overview.delete_planner_view(uuid.UUID(personal['id']), db, PLANT, other)
    assert planning_overview.delete_planner_view(uuid.UUID(personal['id']), db, PLANT, PLANNER)['deleted'] == personal['id']
