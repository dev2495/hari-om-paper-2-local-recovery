"""Client round 28 Oct (floor): the Process count is a flag, the whole printed card closes stages whose runs
were already logged, and a save waits for a card posting instead of failing. Real PostgreSQL only."""
import os
import threading
import time
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

pytestmark = pytest.mark.skipif('hariom_nverify' not in os.getenv('DATABASE_URL', ''), reason='disposable database only')
PLANT = '00000000-0000-0000-0000-0000000000a1'
USER = {'sub': 'floor28-owner', 'roles': ['Owner', 'QC'], 'allowed_plants': [PLANT]}


@pytest.fixture
def card(monkeypatch):
    from src.main import app  # noqa: F401  (creates the tables)
    from src.database import SessionLocal
    from src.models import JobCard, JobCardStage, SalesOrder
    from src.routers import entries as api
    from season_quality import initial_rules, resolve_profile
    db = SessionLocal()
    order = SalesOrder(plant_id=uuid.UUID(PLANT), customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=100, due_date=date.today())
    db.add(order); db.flush()
    limits = {'id_min_mm': 76.2, 'id_max_mm': 76.6, 'od_min_mm': 81, 'od_max_mm': 81, 'length_min_mm': 149.8, 'length_max_mm': 150.2}
    profile = resolve_profile({**limits, 'target_tube_weight': 120, 'required_cs': 400, 'mandrel_diameter_mm': 76.3, 'selected_bamboo_length_mm': 1560}, initial_rules())
    job = JobCard(plant_id=uuid.UUID(PLANT), sales_order_id=order.id, spec_id=order.spec_id, planned_qty=100, released_qty=100,
                  spec_snapshot={'entry_model': 'V2', 'selected_bamboo_length_mm': 1560, 'pcs_per_bamboo': 10, 'qc_profile': profile, **limits},
                  routing_snapshot={'stages': ['WINDER', 'OVEN', 'PROCESS', 'PACKING', 'QC', 'DISPATCH']},
                  material_plan_snapshot={'recipe_snapshot': {'season_revision': 1}}, status='PLANNED', current_stage='WINDER')
    db.add(job); db.flush()
    for stage in api.route(job):
        db.add(JobCardStage(job_card_id=job.id, stage_type=stage, machine_id=uuid.uuid4() if stage in ('WINDER', 'OVEN', 'PROCESS') else None, plan_date=date.today(), shift_code='SHIFT_A'))
    db.commit()
    monkeypatch.setattr(api, 'employee', lambda *args: {'name': 'Operator / Supervisor', 'employee_code': 'E1', 'active': True})
    monkeypatch.setattr(api.planning, '_fetch_machine', lambda machine_id, *args: {'id': str(machine_id), 'plant_id': PLANT, 'department': next(s.stage_type for s in job.stages if s.machine_id == machine_id), 'is_active': True, 'capacity_value': 0, 'id_min_mm': 70, 'id_max_mm': 90, 'od_min_mm': 70, 'od_max_mm': 100, 'length_min_mm': 100, 'length_max_mm': 2000})
    yield api, db, job
    db.rollback(); db.close()


def create(a, db, job, stage='WINDER', **kw):
    values = dict(request_id=str(uuid.uuid4()), stage=stage, business_date=date.today(), shift_code='SHIFT_A', operator_id=uuid.uuid4(), produced=5, accepted=5, submit=True)
    values.update(kw)
    return a.create_entry(job.id, a.EntryInput(**values), db, PLANT, USER)


def winding_samples():
    return [{'sample_id': str(uuid.uuid4()), 'readings': {'id': 76.3, 'od': 82, 'height': 1560, 'weight': 130, 'cs': 165}} for _ in range(2)]


def oven_samples():
    return [{'sample_id': str(uuid.uuid4()), 'readings': {'pre_weight': 1000, 'post_weight': 910, 'pre_moisture': 10, 'post_moisture': 8, 'cs': 420}} for _ in range(2)]


def state(a, db, job, stage):
    return next(s for s in a.flow(db, job)['stages'] if s['stage'] == stage)


def test_process_count_gap_is_saved_and_flagged_not_refused(card):
    a, db, job = card
    create(a, db, job, produced=6, accepted=6, samples=winding_samples())
    create(a, db, job, 'OVEN', produced=6, accepted=6, input_quantity=6, samples=oven_samples())
    # 2 bamboo × 10 pcs = 20, but the run counts 19: saved, flagged, no reason asked for the gap.
    short = create(a, db, job, 'PROCESS', produced=19, accepted=19, input_quantity=2)['entry']
    assert short['status'] == 'SUBMITTED'
    gap = short['details']['count_gap']
    assert gap['gap'] == 1 and gap['possible'] == 20 and gap['counted'] == 19
    assert gap['message'].startswith('2 bamboo × 10 pcs = 20 pcs, but this run counts 19 pcs') and '1 pcs short' in gap['message']
    # More pieces than the bamboo can give is flagged too.
    over = create(a, db, job, 'PROCESS', produced=22, accepted=22, input_quantity=2)['entry']
    assert over['details']['count_gap']['gap'] == -2 and 'more than the bamboo can give' in over['details']['count_gap']['message']
    # A balanced run carries no flag.
    exact = create(a, db, job, 'PROCESS', produced=10, accepted=10, input_quantity=1)['entry']
    assert 'count_gap' not in exact['details']
    process = state(a, db, job, 'PROCESS')
    assert process['count_gap_runs'] == 2 and process['count_gap_pcs'] == -1
    flagged = [row for row in a.flagged_entries(30, 200, db, PLANT, USER) if row['job_card_id'] == str(job.id) and row['flag'] == 'COUNT_GAP']
    assert sorted(row['entry_no'] for row in flagged) == sorted([short['entry_no'], over['entry_no']])
    db.rollback()


def test_other_process_rules_stay(card):
    a, db, job = card
    create(a, db, job, produced=4, accepted=4, samples=winding_samples())
    create(a, db, job, 'OVEN', produced=4, accepted=4, input_quantity=4, samples=oven_samples())
    # A reject still needs its reason; cutting loss written still needs its reason.
    with pytest.raises(HTTPException) as refused:
        create(a, db, job, 'PROCESS', produced=20, accepted=18, input_quantity=2)
    assert refused.value.status_code == 422 and 'Reject reason' in refused.value.detail
    db.rollback()


def test_whole_card_totals_equal_to_logged_runs_add_readings_and_close(card):
    a, db, job = card
    # Runs logged during the day without readings; the printed card's totals are typed later (= what is logged).
    create(a, db, job, produced=6, accepted=6)
    create(a, db, job, produced=4, accepted=4)
    winder = state(a, db, job, 'WINDER')
    assert winder['target'] == 10 and winder['accepted_total'] == 10 and not winder['qc']['ready']
    step = a.BatchStep(
        entry=a.EntryInput(request_id='whole-card-WINDER', stage='WINDER', quantity_mode='TOTAL', expected_version=winder['row_version'], submit=True,
                           business_date=date.today(), shift_code='SHIFT_A', operator_id=uuid.uuid4(), produced=10, accepted=10, samples=winding_samples(),
                           details={'reject_reason': '', 'instrument': {}}),
        close=a.CloseInput(request_id='whole-close-WINDER', expected_version=winder['row_version'] + 1, short_close=False, residual_disposition='HOLD', reason=''))
    result = a.batch_entries(job.id, a.BatchInput(request_id=str(uuid.uuid4()), steps=[step]), db, PLANT, USER)
    winder = next(s for s in result['flow']['stages'] if s['stage'] == 'WINDER')
    assert winder['status'] == 'COMPLETED' and winder['accepted_total'] == 10
    assert [e['kind'] for e in result['entries']] == ['QC_ONLY']
    # The card's readings cover the two runs, so Oven may take all 10 bamboo.
    assert state(a, db, job, 'OVEN')['available_from_upstream'] == 10
    db.rollback()


def test_whole_card_total_below_logged_says_so_in_words(card):
    a, db, job = card
    create(a, db, job, produced=6, accepted=6)
    winder = state(a, db, job, 'WINDER')
    with pytest.raises(HTTPException) as refused:
        create(a, db, job, quantity_mode='TOTAL', expected_version=winder['row_version'], produced=5, accepted=5)
    assert refused.value.status_code == 409 and refused.value.detail.startswith('Winding output total 5 on the card is less than the 6 already logged')
    db.rollback()


def test_save_waits_for_a_card_posting_instead_of_failing(card, monkeypatch):
    a, db, job = card
    from sqlalchemy import text
    from src.database import engine
    key = {'key': 'production-effect:' + str(job.id)}
    holder = engine.connect()
    holder.execute(text('SELECT pg_advisory_lock(hashtext(:key))'), key)
    holder.commit()

    def release():
        time.sleep(0.6)
        holder.execute(text('SELECT pg_advisory_unlock(hashtext(:key))'), key)
        holder.commit()

    threading.Thread(target=release).start()
    started = time.monotonic()
    entry = create(a, db, job, produced=2, accepted=2)['entry']
    assert entry['status'] == 'SUBMITTED' and time.monotonic() - started >= 0.5
    db.rollback()
    holder.execute(text('SELECT pg_advisory_lock(hashtext(:key))'), key); holder.commit()
    monkeypatch.setattr(a, 'CARD_LOCK_WAIT_SECONDS', 0.3)
    try:
        with pytest.raises(HTTPException) as refused:
            create(a, db, job, produced=2, accepted=2)
        assert refused.value.status_code == 409 and 'Nothing was saved' in refused.value.detail
    finally:
        db.rollback()
        holder.execute(text('SELECT pg_advisory_unlock(hashtext(:key))'), key); holder.commit(); holder.close()


def test_whole_card_process_total_is_judged_on_the_stage_totals(card):
    """28 Oct (round 2): a printed card whose Process totals balance leaves no count flag, even when the day's run
    was short; the run's own flag is kept as settled by the card. An unbalanced card total is one flag, in words."""
    a, db, job = card
    create(a, db, job, produced=3, accepted=3, samples=winding_samples())
    create(a, db, job, 'OVEN', produced=3, accepted=3, input_quantity=3, samples=oven_samples())
    run = create(a, db, job, 'PROCESS', produced=19, accepted=19, input_quantity=2)['entry']
    assert run['details']['count_gap']['gap'] == 1
    process = state(a, db, job, 'PROCESS')
    whole = create(a, db, job, 'PROCESS', quantity_mode='TOTAL', expected_version=process['row_version'], produced=20, accepted=20, input_quantity=2)['entry']
    assert whole['produced'] == 1 and whole['input_quantity'] == 0
    assert 'count_gap' not in whole['details'], 'the card totals balance: 2 bamboo × 10 = 20 pcs'
    from src.entry_models import StageEntry
    earlier = db.get(StageEntry, uuid.UUID(run['id']))
    assert 'count_gap' not in earlier.details and earlier.details['count_gap_settled']['settled_by_entry'] == whole['id']
    process = state(a, db, job, 'PROCESS')
    assert process['count_gap_runs'] == 0 and process['count_gap_pcs'] == 0
    assert not [row for row in a.flagged_entries(30, 200, db, PLANT, USER) if row['job_card_id'] == str(job.id) and row['flag'] == 'COUNT_GAP']
    # A later card total that does not balance is judged on the totals (3 bamboo = 30 pcs, the card counts 28).
    more = create(a, db, job, 'PROCESS', quantity_mode='TOTAL', expected_version=process['row_version'], produced=28, accepted=28, input_quantity=3)['entry']
    gap = more['details']['count_gap']
    assert gap['card_total'] and gap['possible'] == 30 and gap['counted'] == 28 and gap['gap'] == 2
    assert gap['message'].startswith('Card total: 3 bamboo × 10 pcs = 30 pcs, but the card counts 28 pcs') and '2 pcs short' in gap['message']
    assert state(a, db, job, 'PROCESS')['count_gap_runs'] == 1
    db.rollback()


def test_a_closed_stage_feeds_the_next_stage_with_readings_counted_together(card):
    """28 Oct (round 2): Winding closed with one reading on the run and one as QC without a run (2 for the stage,
    as the close gate counts them); Oven may then take the bamboo instead of 'waiting for Winding QC'."""
    a, db, job = card
    one = winding_samples()[:1]
    create(a, db, job, produced=10, accepted=10, samples=one)
    assert state(a, db, job, 'OVEN')['available_from_upstream'] == 0
    create(a, db, job, kind='QC_ONLY', produced=0, accepted=0, samples=winding_samples()[:1])
    winder = state(a, db, job, 'WINDER')
    assert winder['qc']['ready'], winder['qc']
    a.close_stage(job.id, 'WINDER', a.CloseInput(request_id=str(uuid.uuid4()), expected_version=winder['row_version'], residual_disposition='HOLD', reason=''), db, PLANT, USER)
    assert state(a, db, job, 'OVEN')['available_from_upstream'] == 10
    oven = create(a, db, job, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples())['entry']
    assert oven['status'] == 'SUBMITTED'
    db.rollback()


def test_flagged_before_planning_says_what_happened_not_the_old_gate(card):
    a, db, job = card
    from src.entry_models import StageEntry
    entry = create(a, db, job, produced=5, accepted=5, samples=winding_samples())['entry']
    row = db.get(StageEntry, uuid.UUID(entry['id']))
    row.details = {**(row.details or {}), 'unscheduled_entry': {'reason': 'Schedule machine, shift, and a planner date in the next 3 days before floor entry.'}}
    db.flush()
    flagged = [r for r in a.flagged_entries(30, 200, db, PLANT, USER) if r['entry_id'] == entry['id'] and r['flag'] == 'UNSCHEDULED']
    assert flagged and flagged[0]['reason'] == 'No planner slot (machine, shift and date) when the run was entered.'
    db.rollback()


def test_voiding_a_whole_card_total_puts_the_runs_count_gap_back(card):
    """30 Oct: voiding the whole-card total row gives the runs it settled their own Process count gap again
    (run, card and Reports › Exceptions); voiding a run re-judges the card total on the rows still live."""
    a, db, job = card
    from src.entry_models import StageEntry
    create(a, db, job, produced=3, accepted=3, samples=winding_samples())
    create(a, db, job, 'OVEN', produced=3, accepted=3, input_quantity=3, samples=oven_samples())
    run = create(a, db, job, 'PROCESS', produced=19, accepted=19, input_quantity=2)['entry']
    process = state(a, db, job, 'PROCESS')
    whole = create(a, db, job, 'PROCESS', quantity_mode='TOTAL', expected_version=process['row_version'], produced=20, accepted=20, input_quantity=2)['entry']
    assert state(a, db, job, 'PROCESS')['count_gap_runs'] == 0
    a.void_entry(job.id, uuid.UUID(whole['id']), a.Mutation(request_id=str(uuid.uuid4()), expected_version=whole['row_version'], reason='typed by mistake'), db, PLANT, USER)
    earlier = db.get(StageEntry, uuid.UUID(run['id']))
    assert earlier.details['count_gap']['gap'] == 1 and 'count_gap_settled' not in earlier.details
    assert 'settled_by_entry' not in earlier.details['count_gap']
    process = state(a, db, job, 'PROCESS')
    assert process['count_gap_runs'] == 1 and process['count_gap_pcs'] == 1
    assert [row['entry_id'] for row in a.flagged_entries(30, 200, db, PLANT, USER) if row['job_card_id'] == str(job.id) and row['flag'] == 'COUNT_GAP'] == [run['id']]
    # A balanced card total over two runs; voiding the second run re-judges the card total on what is left.
    second = create(a, db, job, 'PROCESS', produced=9, accepted=9, input_quantity=1)['entry']
    process = state(a, db, job, 'PROCESS')
    total = create(a, db, job, 'PROCESS', quantity_mode='TOTAL', expected_version=process['row_version'], produced=30, accepted=30, input_quantity=3)['entry']
    assert 'count_gap' not in total['details'] and state(a, db, job, 'PROCESS')['count_gap_runs'] == 0
    a.void_entry(job.id, uuid.UUID(second['id']), a.Mutation(request_id=str(uuid.uuid4()), expected_version=second['row_version'], reason='wrong card'), db, PLANT, USER)
    gap = db.get(StageEntry, uuid.UUID(total['id'])).details['count_gap']
    assert gap['card_total'] and gap['possible'] == 20 and gap['counted'] == 21 and gap['gap'] == -1
    assert gap['message'].startswith('Card total: 2 bamboo × 10 pcs = 20 pcs, but the card counts 21 pcs')
    assert state(a, db, job, 'PROCESS')['count_gap_runs'] == 1
    db.rollback()


def test_close_with_unused_input_offers_hold_or_scrap_never_return(card):
    """30 Oct: nothing returns from the floor, so the close message says hold or scrap and RETURN is refused."""
    a, db, job = card
    create(a, db, job, produced=10, accepted=10, samples=winding_samples())
    winder = state(a, db, job, 'WINDER')
    a.close_stage(job.id, 'WINDER', a.CloseInput(request_id=str(uuid.uuid4()), expected_version=winder['row_version'], reason=''), db, PLANT, USER)
    create(a, db, job, 'OVEN', produced=6, accepted=6, input_quantity=6, samples=oven_samples())
    oven = state(a, db, job, 'OVEN')
    for disposition in (None, 'RETURN'):
        with pytest.raises(HTTPException) as refused:
            a.close_stage(job.id, 'OVEN', a.CloseInput(request_id=str(uuid.uuid4()), expected_version=oven['row_version'], short_close=True, residual_disposition=disposition, reason='Short by 4'), db, PLANT, USER)
        assert refused.value.status_code == 409 and refused.value.detail['code'] == 'RESIDUAL_WIP'
        assert '(hold or scrap)' in refused.value.detail['message'] and 'hold, return' not in refused.value.detail['message']
    assert 'Nothing returns from the floor' in refused.value.detail['message']
    a.close_stage(job.id, 'OVEN', a.CloseInput(request_id=str(uuid.uuid4()), expected_version=oven['row_version'], short_close=True, residual_disposition='HOLD', reason='Short by 4'), db, PLANT, USER)
    assert state(a, db, job, 'OVEN')['status'] == 'COMPLETED'
    db.rollback()
