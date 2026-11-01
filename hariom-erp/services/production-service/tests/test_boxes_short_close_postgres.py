"""Owner decisions 1, 2, 3, 7, 8 (2026-11-01) on a real PostgreSQL database.

The qty chain must be gap-free: release -> stage targets -> runs -> short closes / returns -> boxes (FG) ->
dispatch -> card done. Every scenario checks the invariant: sum of returns + pcs in boxes == pcs released."""
import os
import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

pytestmark = pytest.mark.skipif('hariom_nverify' not in os.getenv('DATABASE_URL', ''), reason='disposable database only')
PLANT = '00000000-0000-0000-0000-0000000000a1'
USER = {'sub': 'box-test-owner', 'roles': ['Owner', 'QC'], 'allowed_plants': [PLANT], 'token': 't'}
FG_ITEM = '11111111-1111-1111-1111-111111111111'


@pytest.fixture
def card(monkeypatch):
    from src.main import app  # noqa: F401  (creates the tables)
    from src.database import SessionLocal
    from src.models import JobCard, JobCardStage, JobCardStageSegment, SalesOrder
    from src.routers import entries as api
    from season_quality import initial_rules, resolve_profile
    db = SessionLocal()
    order = SalesOrder(plant_id=uuid.UUID(PLANT), customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=100, due_date=date.today())
    db.add(order); db.flush()
    profile = resolve_profile({'id_min_mm': 76.2, 'id_max_mm': 76.6, 'od_min_mm': 81, 'od_max_mm': 81, 'length_min_mm': 149.8, 'length_max_mm': 150.2, 'target_tube_weight': 120,
                               'required_cs': 400, 'mandrel_diameter_mm': 76.3, 'selected_bamboo_length_mm': 1560}, initial_rules())
    snap = {'entry_model': 'V2', 'selected_bamboo_length_mm': 1560, 'pcs_per_bamboo': 10, 'qc_profile': profile, 'qty_per_box': 30, 'box_code': 'R-150',
            'fadda_sku': 'FD-3', 'fadda_per_box': 2, 'product_code': 'FG-BOX', 'customer_name_snapshot': 'Box Customer', 'sales_order_order_no': 'SO/26/11/01',
            'sales_order_po_number': 'PO-77', 'id_min_mm': 76.2, 'id_max_mm': 76.6, 'od_min_mm': 81, 'od_max_mm': 81, 'length_min_mm': 149.8, 'length_max_mm': 150.2}
    job = JobCard(plant_id=uuid.UUID(PLANT), sales_order_id=order.id, spec_id=order.spec_id, planned_qty=100, released_qty=100, release_lot_id=uuid.uuid4(),
                  job_card_no=f"T{uuid.uuid4().hex[:6].upper()}", spec_snapshot=snap,
                  routing_snapshot={'stages': ['WINDER', 'OVEN', 'PROCESS', 'PACKING', 'QC', 'DISPATCH']}, material_plan_snapshot={'recipe_snapshot': {'season_revision': 1}},
                  status='PLANNED', current_stage='WINDER')
    db.add(job); db.flush()
    for stage in api.route(job):
        db.add(JobCardStage(job_card_id=job.id, stage_type=stage, machine_id=uuid.uuid4() if stage in ('WINDER', 'OVEN', 'PROCESS') else None, plan_date=date.today(), shift_code='SHIFT_A'))
    db.flush()
    for stage in ('OVEN', 'PROCESS'):
        # Planner slots in pcs: two slots per stage, 50 + 50.
        row = next(s for s in job.stages if s.stage_type == stage)
        for n in (1, 2):
            db.add(JobCardStageSegment(plant_id=job.plant_id, job_card_id=job.id, stage_type=stage, segment_no=n, machine_id=row.machine_id, plan_date=date.today(),
                                       shift_code='SHIFT_A' if n == 1 else 'SHIFT_B', planned_qty=50, required_capacity=10, status='ASSIGNED', sequence_no=n))
    db.commit()
    departments = {}
    monkeypatch.setattr(api, 'employee', lambda employee_id, *args: {'name': 'Op ' + str(employee_id)[:4], 'employee_code': 'E1', 'active': True, 'department': departments.get(str(employee_id), 'ANY')})
    real_check = api.check_department
    monkeypatch.setattr(api, 'check_department', lambda row, stage: None if row.get('department') == 'ANY' else real_check(row, stage))
    monkeypatch.setattr(api, 'deliver_now', lambda *args: None)
    monkeypatch.setattr(api, 'fg_item_for', lambda *args: FG_ITEM)
    monkeypatch.setattr(api.planning, '_fetch_machine', lambda machine_id, *args: {'id': str(machine_id), 'plant_id': PLANT, 'department': next(s.stage_type for s in job.stages if s.machine_id == machine_id),
                                                                                 'is_active': True, 'capacity_value': 0, 'id_min_mm': 70, 'id_max_mm': 90, 'od_min_mm': 70, 'od_max_mm': 100, 'length_min_mm': 100, 'length_max_mm': 2000})
    yield SimpleNamespace(a=api, db=db, job=job, departments=departments)
    db.rollback(); db.close()


def winding_samples():
    return [{'sample_id': str(uuid.uuid4()), 'readings': {'id': 76.3, 'od': 82, 'height': 1560, 'weight': 130, 'cs': 165}} for _ in range(2)]


def oven_samples():
    return [{'sample_id': str(uuid.uuid4()), 'readings': {'pre_weight': 1000, 'post_weight': 910, 'pre_moisture': 10, 'post_moisture': 8, 'cs': 420}} for _ in range(2)]


def process_samples(job, out_of_band=False):
    readings = {}
    for p in job.spec_snapshot['qc_profile']['stages']['PROCESS']['parameters']:
        if not p.get('applicable', True):
            continue
        low, high = p.get('min'), p.get('max')
        readings[p['code']] = (low + high) / 2 if low is not None and high is not None else low + 1 if low is not None else high - 1 if high is not None else 10
    if out_of_band:
        p = next(p for p in job.spec_snapshot['qc_profile']['stages']['PROCESS']['parameters'] if p.get('applicable', True) and p.get('max') is not None)
        readings[p['code']] = p['max'] + 50
    return [{'sample_id': str(uuid.uuid4()), 'readings': dict(readings)} for _ in range(2)]


def create(t, stage='WINDER', **kw):
    values = dict(request_id=str(uuid.uuid4()), stage=stage, business_date=date.today(), shift_code='SHIFT_A', operator_id=uuid.uuid4(), produced=5, accepted=5, submit=True)
    values.update(kw)
    return t.a.create_entry(t.job.id, t.a.EntryInput(**values), t.db, PLANT, USER)


def state(t, stage):
    return next(s for s in t.a.flow(t.db, t.job)['stages'] if s['stage'] == stage)


def close(t, stage, **kw):
    values = dict(request_id=str(uuid.uuid4()), expected_version=state(t, stage)['row_version'])
    values.update(kw)
    # Reasons are master codes (owner decision 4): a short close sends a STAGE_SHORT_CLOSE code with the
    # test's words as its note; leftover input a LEFTOVER_INPUT code.
    if values.get('short_close') and 'reason_code' not in values:
        values.update(reason_code='SS-OTHER', reason_note=values.pop('reason', None))
    if values.get('residual_disposition') and 'residual_reason_code' not in values:
        values['residual_reason_code'] = 'LI-NEXT-RUN'
    return t.a.close_stage(t.job.id, stage, t.a.CloseInput(**values), t.db, PLANT, USER)


def reopen(t, stage, reason='Customer wants the rest after all'):
    return t.a.reopen_stage(t.job.id, stage, t.a.Mutation(request_id=str(uuid.uuid4()), expected_version=state(t, stage)['row_version'], reason_code='EC-OTHER', reason_note=reason), t.db, PLANT, USER)


def boxes(t):
    from src.entry_models import FgBox
    return t.db.query(FgBox).filter_by(job_card_id=t.job.id).order_by(FgBox.seq_no).all()


def returns(t):
    from src.entry_models import CompletionEffect
    return [e for e in t.db.query(CompletionEffect).filter_by(job_card_id=t.job.id, kind='sales_return').all() if e.status != 'CANCELLED']


def invariant(t, released=100):
    """sum of returns + FG in boxes == released pcs (no overproduction)."""
    returned = sum(int(e.payload['qty']) for e in returns(t))
    boxed = sum(b.qty for b in boxes(t) if b.status != 'VOID')
    assert returned + boxed == released, (returned, boxed)
    assert float(t.job.returned_qty) == returned and float(t.job.released_qty) == released - returned


def segments(t, stage):
    from src.models import JobCardStageSegment
    return sorted((s.segment_no, float(s.planned_qty), s.status) for s in t.db.query(JobCardStageSegment).filter_by(job_card_id=t.job.id, stage_type=stage).all())


def test_full_run_packs_boxes_as_runs_are_logged_and_a_part_box_at_close(card):
    t = card
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=65, accepted=65, input_quantity=6, cutting_loss_pcs=0, samples=process_samples(t.job))
    assert [(b.qty, b.is_part) for b in boxes(t)] == [(30, False), (30, False)]  # 5 pcs carry to the next run
    first = boxes(t)[0]
    assert first.box_code == f"B{t.job.job_card_no}-001" and first.allocations[0]['pcs'] == 30 and first.fg_status == 'PENDING'
    assert first.packaging['lines'][0]['code'] == 'R-150' and any(l['code'] == 'FD-3' and l['pcs'] == 2 for l in first.packaging['lines'])
    flow = t.a.flow(t.db, t.job)
    assert flow['boxes']['box_count'] == 2 and flow['boxes']['boxed_pcs'] == 60
    create(t, 'PROCESS', produced=35, accepted=35, input_quantity=4, samples=process_samples(t.job))
    assert [b.qty for b in boxes(t)] == [30, 30, 30]
    preview = state(t, 'PROCESS')['completion_preview']['boxes']
    assert preview['unboxed_pcs'] == 10 and preview['part_box_pcs'] == 10
    close(t, 'PROCESS')
    assert [(b.qty, b.is_part) for b in boxes(t)] == [(30, False), (30, False), (30, False), (10, True)]
    assert not returns(t)
    invariant(t)
    from src.entry_models import CompletionEffect
    kinds = sorted({e.kind for e in t.db.query(CompletionEffect).filter_by(job_card_id=t.job.id)})
    assert 'fg_box' in kinds and 'box_theory' in kinds and 'fg_inward' not in kinds
    assert t.job.status != 'COMPLETED'  # boxes not shipped yet


def test_short_close_at_winding_returns_the_balance_and_shrinks_downstream(card):
    t = card
    create(t, produced=6, accepted=6, samples=winding_samples())
    result = close(t, 'WINDER', short_close=True, reason='Paper ran out; customer takes 60')
    assert result['short_close']['returned_pcs'] == 40
    states = {s['stage']: s for s in result['flow']['stages']}
    assert states['OVEN']['target'] == 6 and all(states[s]['target'] == 60 for s in ('PROCESS', 'PACKING', 'QC', 'DISPATCH'))
    assert states['WINDER']['returned_pcs'] == 40 and states['WINDER']['short_close']['reason'] == 'Ss other — Paper ran out; customer takes 60'
    assert (states['WINDER']['short_close']['reason_code'], states['WINDER']['short_close']['reason_label']) == ('SS-OTHER', 'Ss other')
    assert segments(t, 'PROCESS') == [(1, 50.0, 'ASSIGNED'), (2, 10.0, 'ASSIGNED')]  # latest slot gives first
    assert segments(t, 'OVEN') == [(1, 50.0, 'ASSIGNED'), (2, 10.0, 'ASSIGNED')]
    (effect,) = returns(t)
    assert effect.payload['qty'] == 40 and effect.payload['release_lot_id'] == str(t.job.release_lot_id)
    assert float(t.job.released_qty) == 60 and float(t.job.returned_qty) == 40
    create(t, 'OVEN', produced=6, accepted=6, input_quantity=6, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=60, accepted=58, input_quantity=6, samples=process_samples(t.job), details={'reject_reason': 'Cut ends', 'reject_code': 'CUT'})
    close(t, 'PROCESS', short_close=True, reason='Two tubes rejected at cutting')
    assert sum(int(e.payload['qty']) for e in returns(t)) == 42
    assert [(b.qty, b.is_part) for b in boxes(t)] == [(30, False), (28, True)]
    invariant(t)
    from src.routers.card_history import _audit_event
    from src.models import AuditEvent
    rows = t.db.query(AuditEvent).filter_by(job_card_id=t.job.id, action='close:WINDER').all()
    event = _audit_event(rows[0], t.job.job_card_no)
    assert event['title'] == 'Winding closed short' and '40 pcs back to the order' in event['detail']


def test_reopen_reverses_the_return_and_restores_targets_and_slots(card):
    t = card
    create(t, produced=6, accepted=6, samples=winding_samples())
    close(t, 'WINDER', short_close=True, reason='Short paper today')
    (effect,) = returns(t)
    effect.status = 'DELIVERED'; t.db.commit()
    calls = []
    import httpx

    class Ok:
        status_code = 200
        def json(self): return {}
    t.a.httpx.post = lambda url, **kw: calls.append((url, kw['json'])) or Ok()
    try:
        reopen(t, 'WINDER')
    finally:
        t.a.httpx.post = httpx.post
    assert calls and calls[0][0].endswith('/stage-returns/reverse') and calls[0][1]['return_key'] == effect.payload['return_key']
    assert state(t, 'OVEN')['target'] == 10 and state(t, 'PROCESS')['target'] == 100 and state(t, 'DISPATCH')['target'] == 100
    assert segments(t, 'PROCESS') == [(1, 50.0, 'ASSIGNED'), (2, 50.0, 'ASSIGNED')]
    assert float(t.job.released_qty) == 100 and float(t.job.returned_qty) == 0
    # Finish at full quantity: dispatch is no longer capped at the old short qty (reopen bug fixed).
    create(t, produced=4, accepted=4); close(t, 'WINDER')
    assert state(t, 'WINDER')['short_close'] is None


def test_reopen_before_the_return_reached_sales_cancels_it(card):
    t = card
    create(t, produced=6, accepted=6, samples=winding_samples())
    close(t, 'WINDER', short_close=True, reason='Short paper today')
    reopen(t, 'WINDER')
    from src.entry_models import CompletionEffect
    assert t.db.query(CompletionEffect).filter_by(job_card_id=t.job.id, kind='sales_return').one().status == 'CANCELLED'
    assert float(t.job.released_qty) == 100


def test_reopen_is_refused_when_the_balance_was_released_again(card):
    t = card
    create(t, produced=6, accepted=6, samples=winding_samples())
    close(t, 'WINDER', short_close=True, reason='Short paper today')
    (effect,) = returns(t)
    effect.status = 'DELIVERED'; t.db.commit()
    import httpx

    class Refused:
        status_code = 409
        text = ''
        def json(self): return {'detail': 'only 0 of the 40 pcs this close gave back are still unreleased on order SO-1'}
    t.a.httpx.post = lambda url, **kw: Refused()
    try:
        with pytest.raises(HTTPException) as caught:
            reopen(t, 'WINDER')
    finally:
        t.a.httpx.post = httpx.post
    assert caught.value.status_code == 409 and 'still unreleased' in caught.value.detail
    t.db.rollback()
    assert state(t, 'WINDER')['status'] == 'COMPLETED' and state(t, 'OVEN')['target'] == 6


def test_reopened_process_keeps_its_boxes_and_new_runs_fill_new_boxes(card):
    t = card
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=40, accepted=40, input_quantity=4, samples=process_samples(t.job))
    close(t, 'PROCESS', short_close=True, reason='Machine down; ship 40 now', residual_disposition='HOLD')
    assert [(b.qty, b.is_part) for b in boxes(t)] == [(30, False), (10, True)]
    invariant(t)
    reopen(t, 'PROCESS')
    assert state(t, 'PACKING')['status'] == 'RUNNING' and state(t, 'QC')['status'] == 'RUNNING'
    create(t, 'PROCESS', produced=60, accepted=60, input_quantity=6, samples=process_samples(t.job))
    close(t, 'PROCESS')
    assert [(b.qty, b.is_part) for b in boxes(t)] == [(30, False), (10, True), (30, False), (30, False)]
    invariant(t)


def test_a_packed_run_cannot_be_voided(card):
    t = card
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    entry = create(t, 'PROCESS', produced=30, accepted=30, input_quantity=3, samples=process_samples(t.job))['entry']
    with pytest.raises(HTTPException) as caught:
        t.a.void_entry(t.job.id, uuid.UUID(entry['id']), t.a.Mutation(request_id=str(uuid.uuid4()), expected_version=entry['row_version'], reason_code='EC-WRONG-QTY'), t.db, PLANT, USER)
    assert caught.value.status_code == 409 and 'packed in box' in caught.value.detail


def test_runs_wait_for_readings_and_flags_show_on_the_box(card):
    t = card
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    entry = create(t, 'PROCESS', produced=30, accepted=30, input_quantity=3)['entry']
    assert boxes(t) == []  # readings not done yet: nothing is packed
    t.a.save_observations(t.job.id, uuid.UUID(entry['id']), t.a.Observations(request_id=str(uuid.uuid4()), expected_version=entry['row_version'], samples=process_samples(t.job, out_of_band=True)), t.db, PLANT, USER)
    (box,) = boxes(t)
    assert box.qty == 30 and box.qc_flagged and box.qc_flags  # out of band: flagged, never held
    from src.models import QualityHold
    assert not t.db.query(QualityHold).filter_by(job_card_id=t.job.id).all()


def test_floor_log_needs_an_operator_of_the_stage_department(card):
    t = card
    winder, oven = uuid.uuid4(), uuid.uuid4()
    t.departments.update({str(winder): 'WINDER', str(oven): 'OVEN'})
    create(t, operator_id=winder, produced=10, accepted=10, samples=winding_samples())
    with pytest.raises(HTTPException) as caught:
        create(t, operator_id=oven, produced=1, accepted=1)
    assert caught.value.status_code == 422 and 'Winding department' in caught.value.detail
    t.db.rollback()
    with pytest.raises(HTTPException) as missing:
        t.a.create_entry(t.job.id, t.a.EntryInput(request_id=str(uuid.uuid4()), stage='WINDER', kind='QC_ONLY', business_date=date.today(), samples=winding_samples(), submit=True), t.db, PLANT, USER)
    assert missing.value.status_code == 422 and 'operator' in missing.value.detail


def _seal(t, box_ids, request_id=None):
    from src.routers import dispatch as d
    payload = d.DispatchPayload(job_card_id=t.job.id, dispatch_snapshot={'box_ids': [str(b) for b in box_ids], 'vehicle_no': 'GJ01'}, status='SEALED',
                                dispatch_request_id=request_id or str(uuid.uuid4()))
    return d.create_or_update_dispatch(payload, t.db, PLANT, {**USER, 'roles': ['Owner', 'Dispatch']})


def test_partial_dispatch_by_boxes_then_card_completes_by_boxes(card, monkeypatch):
    t = card
    from src.routers import dispatch as d
    monkeypatch.setattr(d, '_post_sales_request', lambda **kw: {})
    posted = []

    def stock_out(**kw):
        for box in kw['boxes']:
            posted.append(box.box_code)
        return {**kw['snapshot'], 'inventory_dispatch_status': 'POSTED'}
    monkeypatch.setattr(d, '_post_inventory_box_dispatch', stock_out)
    t.job.sales_order_line_id = None; t.db.commit()
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=60, accepted=60, input_quantity=6, samples=process_samples(t.job))
    first, second = boxes(t)
    with pytest.raises(HTTPException) as not_posted:
        _seal(t, [first.id])
    assert not_posted.value.status_code == 409 and 'not in stock yet' in not_posted.value.detail
    t.db.rollback()
    for b in boxes(t):
        b.fg_status = 'POSTED'; b.fg_item_id = uuid.UUID(FG_ITEM); b.inventory_batch_id = uuid.uuid4()
    t.db.commit()
    _seal(t, [first.id])  # Process still running: one box ships
    assert [b.status for b in boxes(t)] == ['DISPATCHED', 'PACKED'] and t.job.status != 'COMPLETED'
    with pytest.raises(HTTPException) as again:
        _seal(t, [first.id])
    assert again.value.status_code == 409 and 'already dispatched' in again.value.detail
    t.db.rollback()
    create(t, 'PROCESS', produced=40, accepted=40, input_quantity=4, samples=process_samples(t.job))
    close(t, 'PROCESS')
    for b in boxes(t):
        if b.fg_status != 'POSTED':
            b.fg_status = 'POSTED'; b.fg_item_id = uuid.UUID(FG_ITEM); b.inventory_batch_id = uuid.uuid4()
    t.db.commit()
    rest = [b.id for b in boxes(t) if b.status == 'PACKED']
    sealed = _seal(t, rest)
    snap = sealed.dispatch_snapshot
    assert snap['box_packing']['qty_per_box'] == 30 and snap['box_packing']['box_count'] == 3 and snap['box_packing']['part_boxes'] == 1
    assert [b['box_code'] for b in snap['boxes']] == [b.box_code for b in boxes(t)[1:]] and snap['dispatch_qty'] == 70
    assert all(b.status == 'DISPATCHED' for b in boxes(t)) and t.job.status == 'COMPLETED' and t.job.current_stage == 'DONE'
    assert posted == [b.box_code for b in boxes(t)]
    invariant(t)


def test_surplus_box_that_does_not_fit_is_kept_and_the_room_goes_back(card, monkeypatch):
    t = card
    from src.routers import dispatch as d
    from src.routers import dispatch_surplus as ds
    monkeypatch.setattr(d, '_post_sales_request', lambda **kw: {})
    monkeypatch.setattr(d, '_post_inventory_box_dispatch', lambda **kw: {**kw['snapshot'], 'inventory_dispatch_status': 'POSTED'})
    import src.completion_worker as worker
    monkeypatch.setattr(worker, 'deliver_keys', lambda keys: None)
    t.job.sales_order_line_id = None; t.db.commit()
    create(t, produced=11, accepted=11, samples=winding_samples(), details={'overproduction_reason_code': 'OV-CUST-EXTRA'}); close(t, 'WINDER')
    create(t, 'OVEN', produced=11, accepted=11, input_quantity=11, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=105, accepted=105, input_quantity=11, cutting_loss_pcs=5, samples=process_samples(t.job), details={'reject_code': 'DM', 'overproduction_reason_code': 'OV-CUST-EXTRA'})
    close(t, 'PROCESS')
    assert [b.qty for b in boxes(t)] == [30, 30, 30, 15]
    for b in boxes(t):
        b.fg_status = 'POSTED'; b.fg_item_id = uuid.UUID(FG_ITEM); b.inventory_batch_id = uuid.uuid4()
    t.db.commit()
    _seal(t, [b.id for b in boxes(t)[:3]])  # 90 of 100 released shipped; the 15-pc part box does not fit in 10
    with pytest.raises(HTTPException) as too_much:
        _seal(t, [boxes(t)[3].id])
    assert too_much.value.status_code == 409 and 'only 10 pcs' in too_much.value.detail
    t.db.rollback()
    result = ds.retain_surplus(t.job.id, ds.RetainSurplusInput(request_id='keep-' + str(t.job.id), expected_remaining_qty=15, reason_code='SR-NEXT-ORDER', reason_note='Part box kept'), t.db, PLANT, {**USER, 'roles': ['Owner']})
    assert result['returned_to_order_qty'] == 10 and result['retained_boxes'] == [boxes(t)[3].box_code]
    assert (result['reason_code'], result['reason_label'], result['reason']) == ('SR-NEXT-ORDER', 'Sr next order', 'Sr next order — Part box kept')
    t.db.refresh(t.job)
    assert t.job.status == 'COMPLETED' and float(t.job.returned_qty) == 10 and float(t.job.released_qty) == 90
    assert boxes(t)[3].status == 'RETAINED'


def test_box_fg_posting_uses_the_box_code_as_batch(card, monkeypatch):
    t = card
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=30, accepted=30, input_quantity=3, samples=process_samples(t.job))
    (box,) = boxes(t)
    import src.completion_worker as worker
    sent = []

    class Ok:
        status_code = 201
        def json(self): return {'batch_id': str(uuid.uuid4()), 'transaction_id': str(uuid.uuid4())}
    import httpx
    monkeypatch.setattr(httpx, 'post', lambda url, json=None, **kw: sent.append((url, json)) or Ok())
    monkeypatch.setattr('src.routers.entries.fg_item_for', lambda *a: FG_ITEM)
    worker.post_box_fg(t.db, t.job, box, {'sub': 'worker', 'token': 'x'})
    url, body = sent[0]
    assert url.endswith('/fg-inward/') and body['batch_no'] == box.box_code and body['qty'] == 30 and body['external_ref'] == f'FG-BOX-{box.id}'
    assert box.fg_status == 'POSTED' and box.inventory_batch_id


def test_box_packing_theory_counts_boxes_and_warns_instead_of_dropping(card):
    t = card
    from src.routers import planning
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=100, accepted=100, input_quantity=10, samples=process_samples(t.job))
    close(t, 'PROCESS')
    rows = planning._packaging_theory_rows(job_card=t.job, inventory_items=[{'item_code': 'R-150', 'uom': 'PCS', 'name': 'Box R-150'}, {'item_code': 'FD-3', 'uom': 'KG', 'name': 'Fadda'}], produced_qty=100)
    by = {r['item_code']: r for r in rows}
    assert by['R-150']['provisional_theory_consumption_kg'] == 4  # 3 full + 1 part box
    assert by['FD-3']['pieces'] == 8 and by['FD-3']['unit'] == 'PCS' and by['FD-3']['warnings']  # kg item without weight: kept with a warning
    assert planning._job_card_produced_qty_for_theory(t.job) == 100


def test_reopen_refused_for_scrapped_leftover_never_asks_sales(card):
    """Verifier 2026-11-01: a refusal must come before Sales takes the balance back (Sales commits at once)."""
    t = card
    create(t, produced=6, accepted=6, samples=winding_samples())
    close(t, 'WINDER', short_close=True, reason='Short paper today')
    create(t, 'OVEN', produced=5, accepted=5, input_quantity=5, samples=oven_samples())
    close(t, 'OVEN', short_close=True, reason='One bamboo cracked', residual_disposition='SCRAP')
    for e in returns(t):
        e.status = 'DELIVERED'
    t.db.commit()
    calls = []
    import httpx
    t.a.httpx.post = lambda url, **kw: calls.append(url)
    try:
        with pytest.raises(HTTPException) as caught:
            reopen(t, 'OVEN')
    finally:
        t.a.httpx.post = httpx.post
    assert caught.value.status_code == 409 and 'scrapped' in caught.value.detail and calls == []


def test_reopen_after_a_failed_delivery_asks_sales_and_accepts_nothing_recorded(card):
    """A tried-but-failed return may have reached Sales: the reopen asks Sales to reverse it (404 = never recorded)."""
    t = card
    create(t, produced=6, accepted=6, samples=winding_samples())
    close(t, 'WINDER', short_close=True, reason='Short paper today')
    (effect,) = returns(t)
    effect.status = 'FAILED'; effect.attempts = 1; t.db.commit()
    calls = []
    import httpx

    class Missing:
        status_code = 404
        text = ''
        def json(self): return {'detail': 'This short close gave nothing back to the order'}
    t.a.httpx.post = lambda url, **kw: calls.append(url) or Missing()
    try:
        reopen(t, 'WINDER')
    finally:
        t.a.httpx.post = httpx.post
    assert calls and calls[0].endswith('/stage-returns/reverse')
    from src.entry_models import CompletionEffect
    assert t.db.query(CompletionEffect).filter_by(job_card_id=t.job.id, kind='sales_return').one().status == 'CANCELLED'
    assert float(t.job.released_qty) == 100 and float(t.job.returned_qty) == 0


def test_surplus_waits_for_every_packed_box_to_be_in_stock(card, monkeypatch):
    t = card
    from src.routers import dispatch_surplus as ds
    t.job.sales_order_line_id = None; t.db.commit()
    create(t, produced=11, accepted=11, samples=winding_samples(), details={'overproduction_reason_code': 'OV-CUST-EXTRA'}); close(t, 'WINDER')
    create(t, 'OVEN', produced=11, accepted=11, input_quantity=11, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=105, accepted=105, input_quantity=11, cutting_loss_pcs=5, samples=process_samples(t.job), details={'reject_code': 'DM', 'overproduction_reason_code': 'OV-CUST-EXTRA'})
    close(t, 'PROCESS')
    for b in boxes(t)[:3]:
        b.fg_status = 'POSTED'
    boxes(t)[3].fg_status = 'PENDING'
    t.db.commit()
    with pytest.raises(HTTPException) as caught:
        ds.retain_surplus(t.job.id, ds.RetainSurplusInput(request_id='keep-' + str(t.job.id), expected_remaining_qty=105, reason_code='SR-NEXT-ORDER', reason_note='Part box kept'), t.db, PLANT, {**USER, 'roles': ['Owner']})
    assert caught.value.status_code == 409 and 'not in stock yet' in caught.value.detail


def test_reopened_stage_stays_open_when_the_next_run_syncs_its_slots(card):
    """Verifier 2026-11-01 (seen on the local stack): after a reopen every slot of the stage was still COMPLETED,
    so the next unplanned run's slot sync marked the stage COMPLETED again with no close, part box or return."""
    t = card
    from src.models import JobCardStageSegment
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=90, accepted=90, input_quantity=9, samples=process_samples(t.job))
    close(t, 'PROCESS', short_close=True, reason='Machine down; ship 90 now', residual_disposition='HOLD')
    reopen(t, 'PROCESS')
    slots = t.db.query(JobCardStageSegment).filter_by(job_card_id=t.job.id, stage_type='PROCESS').all()
    assert sorted(s.status for s in slots).count('RUNNING') == 1
    stage_row = next(s for s in t.job.stages if s.stage_type == 'PROCESS')
    t.a.planning._sync_stage_row_from_segments(stage_row, t.a.planning._all_stage_segments(t.db, t.job.id, 'PROCESS'))
    assert stage_row.status == 'RUNNING'
    create(t, 'PROCESS', produced=10, accepted=10, input_quantity=1, samples=process_samples(t.job))
    assert state(t, 'PROCESS')['status'] != 'COMPLETED'
    close(t, 'PROCESS')
    assert sum(b.qty for b in boxes(t)) == 100
    invariant(t)


def test_card_manager_shows_the_cut_targets_and_good_totals(card):
    """Verifier 2026-11-01: the Job card manager's stage track read the original plan (Oven 25/50 b after Winding
    closed short at 30 of 50) instead of the card page's numbers."""
    t = card
    from src.routers import lifecycle
    create(t, produced=6, accepted=6, samples=winding_samples())
    close(t, 'WINDER', short_close=True, reason='Short paper today')
    create(t, 'OVEN', produced=5, accepted=5, input_quantity=5, samples=oven_samples())
    data = lifecycle.get_job_card_lifecycle(t.job.id, t.db, PLANT, USER)
    stages = {s['stage']: s for s in data['stages']}
    assert stages['OVEN']['planned_in_unit'] == 6 and stages['OVEN']['output_qty'] == 5
    assert stages['PROCESS']['planned_in_unit'] == 60 and data['planned_qty'] == 60 and data['max_output_qty'] == 66


def test_each_box_adds_only_its_own_packing_theory_and_totals_match_the_whole_card_posting(card, monkeypatch):
    """Issue #13: a box posts its own packing (incremental), not the whole card again. The sum over the boxes equals
    the old whole-card posting, the month is the same, and Process close (whole card) adds nothing twice."""
    from src.models import MonthlyMaterialProvisional
    t = card
    planning = t.a.planning
    items = [{'item_code': 'R-150', 'name': 'Box R-150', 'uom': 'PCS'}, {'item_code': 'FD-3', 'name': 'Fadda FD-3', 'uom': 'KG'}]
    calls = {'inventory': 0, 'paper': 0}
    monkeypatch.setattr(planning, '_fetch_inventory_item_catalog_for_theory', lambda *a, **k: calls.__setitem__('inventory', calls['inventory'] + 1) or items)
    monkeypatch.setattr(planning, '_fetch_paper_catalog_for_theory', lambda *a, **k: calls.__setitem__('paper', calls['paper'] + 1) or {})
    monkeypatch.setattr(planning, '_fetch_adhesive_catalog_for_theory', lambda *a, **k: {})
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=95, accepted=95, input_quantity=10, cutting_loss_pcs=0, samples=process_samples(t.job))
    packed = boxes(t)
    assert [b.qty for b in packed] == [30, 30, 30]
    for b in packed:  # fadda weight from the Packaging master (kg item)
        b.packaging = {**b.packaging, 'lines': [{**line, 'unit_weight_kg': 0.05} if line['code'] == 'FD-3' else line for line in b.packaging['lines']]}
    t.db.flush()

    def posted():
        t.db.flush()
        return {(r.month_start, r.item_code): (round(r.provisional_theory_consumption_kg, 6), r.snapshot.get('pieces'), r.snapshot.get('box_count'))
                for r in t.db.query(MonthlyMaterialProvisional).filter_by(job_card_id=t.job.id).all()}

    def clear():
        t.db.query(MonthlyMaterialProvisional).filter_by(job_card_id=t.job.id).delete(); t.db.flush()

    # The old way: the whole card posted (what every box used to re-post).
    planning._upsert_monthly_provisional_theory(db=t.db, job_card=t.job, selected_stage='PROCESS', token='t', plant_id=PLANT, current_user=USER)
    whole_card = posted()
    month = next(iter(whole_card))[0]
    assert whole_card == {(month, 'R-150'): (3.0, 3.0, 3), (month, 'FD-3'): (0.3, 6.0, 3)}
    clear()
    calls.update(inventory=0, paper=0)
    for b in packed:
        assert planning._post_box_packaging_theory(db=t.db, job_card=t.job, box=b, token='t', plant_id=PLANT, current_user=USER) == 'added'
    assert posted() == whole_card  # same month, same kg / pcs / box count
    assert calls['paper'] == 0  # paper, adhesive and parchment are not re-posted per box
    # A retried box adds nothing.
    assert planning._post_box_packaging_theory(db=t.db, job_card=t.job, box=packed[1], token='t', plant_id=PLANT, current_user=USER) == 'skipped'
    assert posted() == whole_card
    # Process close re-posts the whole card: the totals are the old ones, with the part box added once.
    close(t, 'PROCESS', short_close=True, reason='Five tubes short at the end')
    part = boxes(t)[-1]
    assert part.is_part and part.qty == 5
    part.packaging = {**part.packaging, 'lines': [{**line, 'unit_weight_kg': 0.05} if line['code'] == 'FD-3' else line for line in part.packaging['lines']]}
    planning._upsert_monthly_provisional_theory(db=t.db, job_card=t.job, selected_stage='PROCESS', token='t', plant_id=PLANT, current_user=USER)
    closed = posted()
    assert closed[(month, 'R-150')][:2] == (4.0, 4.0) and closed[(month, 'R-150')][2] == 4
    # The part box's own effect running after the close does not add it a second time.
    assert planning._post_box_packaging_theory(db=t.db, job_card=t.job, box=part, token='t', plant_id=PLANT, current_user=USER) == 'skipped'
    assert posted() == closed


def test_reopen_leaves_delivered_tools_and_theory_alone_and_the_next_close_reposts_them(card):
    """Issue #4: a reopen used to cancel DELIVERED tools / theory postings. They now stay DELIVERED (the record of
    what was posted), a second reopen is not refused for them, and closing again re-arms both to re-post."""
    from src.entry_models import CompletionEffect
    t = card
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=90, accepted=90, input_quantity=9, samples=process_samples(t.job))
    close(t, 'PROCESS', short_close=True, reason='Machine down; ship 90 now', residual_disposition='HOLD')

    def posting(kind):
        return t.db.query(CompletionEffect).filter_by(job_card_id=t.job.id, effect_key=f"{t.job.id}:PROCESS:{kind}").one()
    for kind in ('tools', 'theory'):
        row = posting(kind)
        row.status, row.attempts = 'DELIVERED', 1
        if kind == 'tools':
            row.payload = {**row.payload, 'posted_tool_asset_ids': []}
    t.db.flush()
    reopen(t, 'PROCESS')
    assert (posting('tools').status, posting('theory').status) == ('DELIVERED', 'DELIVERED')
    create(t, 'PROCESS', produced=10, accepted=10, input_quantity=1, samples=process_samples(t.job))
    close(t, 'PROCESS')
    assert (posting('tools').status, posting('theory').status) == ('PENDING', 'PENDING')
    invariant(t)


def test_box_page_finds_a_box_typed_without_dashes_when_only_one_box_matches(card):
    """Issue #10: b261102007 / 'B261102 007' find B261102-007; an unknown or too-short code finds nothing."""
    from src.routers import boxes_api
    t = card
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=65, accepted=65, input_quantity=6, cutting_loss_pcs=0, samples=process_samples(t.job))
    first = boxes(t)[0]
    code = first.box_code
    for typed in (code, code.lower(), code.replace('-', ''), code.replace('-', ' ').lower()):
        assert boxes_api.find_box(t.db, typed, PLANT).id == first.id, typed
        assert boxes_api.box_page(typed, t.db, PLANT, USER)['box_code'] == code
    assert boxes_api.find_box(t.db, code.replace('-', '') + '9', PLANT) is None
    assert boxes_api.find_box(t.db, 'B12', PLANT) is None
