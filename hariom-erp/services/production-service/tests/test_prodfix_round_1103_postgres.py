"""Review fixes of 3 Nov 2026 on a real PostgreSQL database: cancel a half-sealed shipment, V2 Final QC
flags instead of blocking, reopen with posted tool usage, and plant isolation of records loaded by id."""
import os
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

pytestmark = pytest.mark.skipif('hariom_nverify' not in os.getenv('DATABASE_URL', ''), reason='disposable database only')

from tests.test_boxes_short_close_postgres import (  # noqa: E402  (shared box-card fixture and helpers)
    FG_ITEM, PLANT, USER, boxes, card, close, create, oven_samples, process_samples, reopen, state, winding_samples,
)

import src.routers.dispatch  # noqa: E402,F401  (loaded first, so conftest keeps the challan masters offline)

OTHER_PLANT = '00000000-0000-0000-0000-0000000000b2'
DISPATCH_USER = {**USER, 'roles': ['Owner', 'Dispatch']}


def _boxed_card(t, monkeypatch, pcs=60):
    t.job.sales_order_line_id = None; t.db.commit()
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    create(t, 'OVEN', produced=10, accepted=10, input_quantity=10, samples=oven_samples()); close(t, 'OVEN')
    create(t, 'PROCESS', produced=pcs, accepted=pcs, input_quantity=pcs // 10, samples=process_samples(t.job))
    for b in boxes(t):
        b.fg_status = 'POSTED'; b.fg_item_id = uuid.UUID(FG_ITEM); b.inventory_batch_id = uuid.uuid4()
    t.db.commit()


def _seal(t, box_ids, request_id=None):
    from src.routers import dispatch as d
    payload = d.DispatchPayload(job_card_id=t.job.id, dispatch_snapshot={'box_ids': [str(b) for b in box_ids]}, status='SEALED',
                                dispatch_request_id=request_id or str(uuid.uuid4()))
    return d.create_or_update_dispatch(payload, t.db, PLANT, DISPATCH_USER)


def _cancel(t, dispatch_id, plant=PLANT, code='EC-OTHER', note='Truck did not come'):
    from src.routers import dispatch as d
    return d.cancel_unfinished_shipment(dispatch_id, d.CancelShipmentInput(reason_code=code, reason_note=note), t.db, plant, DISPATCH_USER)


# 1. Cancel a shipment whose seal failed half way ─────────────────────────────────────────────────────────

def test_failed_seal_can_be_cancelled_and_its_boxes_ship_on_a_new_challan(card, monkeypatch):
    t = card
    from src.routers import dispatch as d
    from src.models import AuditEvent, Dispatch, DispatchIdempotency
    monkeypatch.setattr(d, '_post_sales_request', lambda **kw: {})
    refs_seen = []

    def stock_out_fails_after_first(**kw):
        snap = kw['snapshot']
        first = kw['boxes'][0]
        refs_seen.append(d._box_external_ref(snap, first.id))
        snap['inventory_box_transactions'] = {str(first.id): 'tx-1'}
        raise HTTPException(502, 'Stores went away half way')
    monkeypatch.setattr(d, '_post_inventory_box_dispatch', stock_out_fails_after_first)
    _boxed_card(t, monkeypatch)
    first, second = boxes(t)
    request_id = str(uuid.uuid4())
    with pytest.raises(HTTPException) as failed:
        _seal(t, [first.id, second.id], request_id)
    assert 'half way' in str(failed.value.detail), failed.value.detail
    draft = t.db.query(Dispatch).filter_by(job_card_id=t.job.id, status='DRAFT').one()
    assert draft.dispatch_snapshot['orchestration_state'] == 'FAILED' and draft.dispatch_snapshot['box_ref_scope'] == str(draft.id)
    # A new challan is refused while the failed one is there (the bug: Retry was the only way out).
    monkeypatch.setattr(d, '_post_inventory_box_dispatch', lambda **kw: {**kw['snapshot'], 'inventory_dispatch_status': 'POSTED'})
    with pytest.raises(HTTPException) as blocked:
        _seal(t, [first.id])
    assert blocked.value.status_code == 409 and 'unfinished shipment' in blocked.value.detail
    t.db.rollback()

    reversed_refs = []
    monkeypatch.setattr(d, '_reverse_shipment_stock', lambda refs, **kw: reversed_refs.extend(refs) or [{'external_ref': r, 'status': 'REVERSED'} for r in refs])
    draft_id = draft.id
    # Another plant cannot see or cancel it.
    with pytest.raises(HTTPException) as foreign:
        _cancel(t, draft_id, plant=OTHER_PLANT)
    assert foreign.value.status_code in (403, 404)
    t.db.rollback()
    result = _cancel(t, draft_id)
    assert result['cancelled'] and result['reason_code'] == 'EC-OTHER'
    # Both boxes' stock keys are put back (the posted one and the one whose reply may have been lost).
    assert reversed_refs == [f'PROD-DISPATCH-BOX-{first.id}-{draft_id}', f'PROD-DISPATCH-BOX-{second.id}-{draft_id}']
    assert t.db.query(Dispatch).filter_by(id=draft_id).first() is None
    audit = t.db.query(AuditEvent).filter_by(job_card_id=t.job.id, action='SHIPMENT_CANCELLED').one()
    assert audit.payload['reason_code'] == 'EC-OTHER' and audit.payload['box_ids']
    idem = t.db.query(DispatchIdempotency).filter_by(request_id=request_id).one()
    assert idem.response_snapshot['orchestration_state'] == 'CANCELLED'
    assert all(b.status == 'PACKED' and b.dispatch_id is None for b in boxes(t))
    # The cancelled command is never resumed; a new challan ships the same boxes under new stock keys.
    with pytest.raises(HTTPException) as replay:
        _seal(t, [first.id, second.id], request_id)
    assert replay.value.status_code == 409 and 'cancelled' in replay.value.detail
    t.db.rollback()
    sealed = _seal(t, [first.id, second.id])
    assert sealed.status == 'SEALED' and sealed.dispatch_snapshot['box_ref_scope'] == str(sealed.id) != str(draft_id)
    assert all(b.status == 'DISPATCHED' for b in boxes(t))


def test_cancel_is_refused_once_sales_counts_the_shipment_and_for_a_plain_draft(card, monkeypatch):
    t = card
    from src.routers import dispatch as d
    from src.models import Dispatch
    _boxed_card(t, monkeypatch)
    plain = Dispatch(job_card_id=t.job.id, dispatch_snapshot={'box_ids': []}, status='DRAFT')
    t.db.add(plain); t.db.commit()
    with pytest.raises(HTTPException) as not_stuck:
        _cancel(t, plain.id)
    assert not_stuck.value.status_code == 409 and 'stopped half way' in not_stuck.value.detail
    t.db.rollback()
    plain.dispatch_snapshot = {'box_ids': [str(boxes(t)[0].id)], 'orchestration_state': 'FAILED', 'sales_dispatch_ref': 'DISPATCH-REQUEST:abc',
                               'inventory_dispatch_status': 'POSTED'}
    t.job.sales_order_line_id = uuid.uuid4(); t.db.commit()
    monkeypatch.setattr(d, '_sales_counts_shipment', lambda *a: True)
    monkeypatch.setattr(d, '_reverse_shipment_stock', lambda *a, **k: pytest.fail('stock must not move back once Sales counts it'))
    with pytest.raises(HTTPException) as counted:
        _cancel(t, plain.id)
    assert counted.value.status_code == 409 and 'Retry shipment' in counted.value.detail
    t.db.rollback()
    assert t.db.query(Dispatch).filter_by(id=plain.id).one().status == 'DRAFT'
    with pytest.raises(HTTPException) as no_reason:
        d.cancel_unfinished_shipment(plain.id, d.CancelShipmentInput(), t.db, PLANT, DISPATCH_USER)
    assert no_reason.value.status_code == 422


# 3. V2 Final QC flags, never blocks ───────────────────────────────────────────────────────────────────────

def _final_qc_card(db):
    from src.models import JobCard, JobCardStage, SalesOrder
    order = SalesOrder(plant_id=uuid.UUID(PLANT), customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=100, due_date=date.today())
    db.add(order); db.flush()
    snap = {'entry_model': 'V2', 'id_min_mm': 76.2, 'id_max_mm': 76.6, 'od_min_mm': 80, 'od_max_mm': 82, 'length_min_mm': 149, 'length_max_mm': 151,
            'weight_min_g': 100, 'weight_max_g': 140, 'cs_min_n': 400, 'cs_max_n': 900}
    # An older card: no Process stage, so its Final QC step still shows.
    job = JobCard(plant_id=uuid.UUID(PLANT), sales_order_id=order.id, spec_id=order.spec_id, planned_qty=100, released_qty=100,
                  job_card_no=f"Q{uuid.uuid4().hex[:6].upper()}", spec_snapshot=snap,
                  routing_snapshot={'stages': ['WINDER', 'OVEN', 'PACKING', 'QC', 'DISPATCH']}, status='IN_PROGRESS', current_stage='QC')
    db.add(job); db.flush()
    for stage in job.routing_snapshot['stages']:
        db.add(JobCardStage(job_card_id=job.id, stage_type=stage, status='COMPLETED' if stage in ('WINDER', 'OVEN', 'PACKING') else 'RUNNING'))
    db.flush()
    return job


def _final_reading(db, job, status, od=81.0, evaluation=None):
    from src.models import QualityInspection
    row = QualityInspection(plant_id=job.plant_id, job_card_id=job.id, stage_type='QC', status=status, sample_id=str(uuid.uuid4()),
                            readings={'id': 76.4, 'od': od, 'length': 150, 'weight': 120, 'cs': 500}, failures=[], reasons={},
                            evaluation=dict(evaluation or {}), observation_fingerprint=uuid.uuid4().hex, entry_mode='IMPORT')
    db.add(row); db.flush()
    return row


def test_out_of_band_final_qc_on_an_older_v2_card_counts_as_accepted_and_flagged():
    from src.main import app  # noqa: F401
    from src.database import SessionLocal
    from src.routers import entries, planning
    db = SessionLocal()
    try:
        job = _final_qc_card(db)
        _final_reading(db, job, 'PASS')
        _final_reading(db, job, 'FAIL', od=95.0, evaluation={'flagged': True, 'gating': 'advisory'})  # saved before the fix
        assert planning._final_spec_qc_passed(db=db, plant_id=job.plant_id, job_card=job)
        qc = next(s for s in entries.flow(db, job)['stages'] if s['stage'] == 'QC')
        assert qc['qc']['ready'] and qc['qc']['flagged'] == 1 and qc['qc_flagged_runs'] == 1
        assert 'Required QC samples or dispositions incomplete' not in qc['blockers']
        # Old-form (V1) cards keep their own rule: only readings marked flagged-not-held count.
        job.spec_snapshot = {**job.spec_snapshot, 'entry_model': 'V1'}
        assert not planning._final_spec_qc_passed(db=db, plant_id=job.plant_id, job_card=job)
        # A superseded reading never counts.
        superseded = _final_reading(db, job, 'FAIL', od=95.0, evaluation={'flagged_not_held': True, 'workflow_status': 'SUPERSEDED'})
        assert not planning._final_qc_flagged_not_held(superseded, job)
    finally:
        db.rollback(); db.close()


# 4. Reopen after tool usage was posted ────────────────────────────────────────────────────────────────────

def _tools_effect(t, stage='WINDER'):
    from src.entry_models import CompletionEffect
    return t.db.query(CompletionEffect).filter_by(effect_key=f'{t.job.id}:{stage}:tools').one()


def test_reopen_after_posted_tool_usage_queues_its_reversal_and_reposts_under_new_keys(card, monkeypatch):
    t = card
    from src.entry_models import CompletionEffect
    from src.routers import planning
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    tools = _tools_effect(t)
    from src.models import JobCardStage
    stage_id = t.db.query(JobCardStage).filter_by(job_card_id=t.job.id, stage_type='WINDER').one().id
    posted_key = planning.tool_usage_key(t.job.id, stage_id, stage_id, 'TOOL-1')
    tools.status = 'DELIVERED'; tools.attempts = 1; tools.payload = {**tools.payload, 'posted_tool_asset_ids': ['TOOL-1'], 'posted_usage_keys': [posted_key]}
    t.db.commit()
    reopened = reopen(t, 'WINDER')  # was refused before: "Posted or uncertain tool usage requires governed reversal"
    assert next(s for s in reopened['flow']['stages'] if s['stage'] == 'WINDER')['status'] == 'RUNNING'
    reversal = t.db.query(CompletionEffect).filter_by(effect_key=f'{t.job.id}:WINDER:tools_reversal:0').one()
    assert reversal.kind == 'tools_reversal' and reversal.payload['usage_keys'] == [posted_key] and not reversal.payload['uncertain']
    assert reversal.payload['reason_code'] == 'EC-OTHER'
    t.db.refresh(tools)
    assert tools.payload['usage_round'] == 1 and tools.payload['posted_usage_keys'] == []
    # Closing again posts under round-1 keys, so Stores counts the final totals once (after the reversal lands).
    assert planning.tool_usage_key(t.job.id, stage_id, stage_id, 'TOOL-1', 1) == posted_key + ':r1'
    close(t, 'WINDER')
    t.db.refresh(tools)
    assert tools.status == 'PENDING' and tools.payload['usage_round'] == 1


def test_reopen_while_tool_posting_is_still_failing_cancels_it_and_reverses_what_may_have_landed(card):
    t = card
    from src.entry_models import CompletionEffect
    create(t, produced=10, accepted=10, samples=winding_samples()); close(t, 'WINDER')
    tools = _tools_effect(t)
    tools.status = 'FAILED'; tools.attempts = 2; tools.last_error = 'HTTPException: Tool T-9 usage could not be recorded'
    tools.payload = {**tools.payload, 'posted_usage_keys': ['k-landed']}
    t.db.commit()
    reopen(t, 'WINDER')
    t.db.refresh(tools)
    assert tools.status == 'CANCELLED'
    reversal = t.db.query(CompletionEffect).filter_by(effect_key=f'{t.job.id}:WINDER:tools_reversal:0').one()
    assert reversal.payload['uncertain'] and reversal.payload['usage_keys'] == ['k-landed']
    assert reversal.payload['usage_key_prefix'].startswith(f'{t.job.id}:')


def test_worker_delivers_the_tool_reversal_and_waits_while_stores_cannot_take_it(card, monkeypatch):
    t = card
    import httpx
    import src.completion_worker as worker
    from src.entry_models import CompletionEffect
    effect = CompletionEffect(job_card_id=t.job.id, effect_key=f'{t.job.id}:WINDER:tools_reversal:9', kind='tools_reversal',
                              payload={'stage': 'WINDER', 'plant_id': PLANT, 'usage_keys': ['k1'], 'usage_round': 9, 'uncertain': False})
    t.db.add(effect); t.db.commit()
    sent = []

    def answer(code):
        def post(url, json=None, **kw):
            sent.append((url, json))
            return httpx.Response(code, json={}, request=httpx.Request('POST', url))
        return post
    monkeypatch.setattr(httpx, 'post', answer(404))
    worker.deliver_one(effect_key=effect.effect_key)
    t.db.expire_all()
    assert effect.status == 'FAILED' and 'cannot take back tool usage yet' in effect.last_error
    assert sent[-1][0].endswith('/inventory/tools/usage/reverse') and sent[-1][1]['usage_keys'] == ['k1'] and sent[-1][1]['reversal_key'] == effect.effect_key
    monkeypatch.setattr(httpx, 'post', answer(200))
    worker.deliver_one(effect_key=effect.effect_key)
    t.db.expire_all()
    assert effect.status == 'DELIVERED'


# 7. Plant isolation of records loaded by id ───────────────────────────────────────────────────────────────

def test_a_challan_cannot_carry_another_cards_box(card, monkeypatch):
    t = card
    from src.routers import dispatch as d
    from src.entry_models import FgBox
    _boxed_card(t, monkeypatch, pcs=30)
    (own,) = boxes(t)
    # Same card id but saved in another plant: the challan must not even lock it.
    foreign = FgBox(**{c.name: getattr(own, c.name) for c in FgBox.__table__.columns if c.name not in ('id', 'box_code', 'seq_no', 'plant_id')},
                    plant_id=uuid.UUID(OTHER_PLANT), box_code=own.box_code + 'X', seq_no=99)
    t.db.add(foreign); t.db.commit()
    with pytest.raises(HTTPException) as refused:
        d._challan_boxes(t.db, t.job, {'box_ids': [str(foreign.id)]}, d.Dispatch(id=uuid.uuid4(), job_card_id=t.job.id))
    assert refused.value.status_code == 404
    t.db.rollback()
    t.db.delete(t.db.get(FgBox, foreign.id)); t.db.commit()


def test_hold_cannot_point_at_another_cards_inspection_and_spec_usage_stays_in_plant():
    from src.main import app  # noqa: F401
    from src.database import SessionLocal
    from src.routers import lifecycle, quality
    db = SessionLocal()
    try:
        job = _final_qc_card(db)
        other = _final_qc_card(db)
        foreign_reading = _final_reading(db, other, 'PASS')
        payload = quality.HoldCreate(job_card_id=job.id, stage_type='QC', reason_code='QH-OTHER', reason_note='checking a bad lot', source_inspection_id=foreign_reading.id)
        with pytest.raises(HTTPException) as refused:
            quality.create_hold(payload, db, PLANT, {**USER, 'roles': ['Admin']})
        assert refused.value.status_code == 404 and 'Inspection not found' in refused.value.detail
        db.rollback()
        job = _final_qc_card(db)
        db.commit()
        here = lifecycle.job_cards_spec_usage(job.spec_id, db, {'selected_plant_id': PLANT, 'scope_all': False}, USER)
        away = lifecycle.job_cards_spec_usage(job.spec_id, db, {'selected_plant_id': OTHER_PLANT, 'scope_all': False}, USER)
        assert here['open_job_cards'] == 1 and away['open_job_cards'] == 0
    finally:
        db.rollback(); db.close()
