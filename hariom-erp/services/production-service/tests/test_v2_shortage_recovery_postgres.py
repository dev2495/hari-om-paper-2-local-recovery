"""Two real PostgreSQL service contracts: QC shortage -> replacement -> fulfillment.

Only HTTP transport and the external Inventory receiver are replaced. Operations,
Sales, routes, quantity conservation, dispatch persistence and retries are real.
"""
import importlib
import os
import sys
import types
import uuid
from copy import deepcopy
from datetime import date
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder

if 'hardening_test' not in os.getenv('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL', allow_module_level=True)

PLANT = '00000000-0000-0000-0000-0000000000a1'
USER = {'roles': ['Owner'], 'sub': 'shortage-contract', 'token': 'test', 'allowed_plants': [PLANT]}
SCOPE = {'scope_all': False, 'selected_plant_id': PLANT, 'allowed_plants': [PLANT]}
ROUTE = ['WINDER', 'OVEN', 'PROCESS', 'PACKING', 'QC', 'DISPATCH']


@pytest.fixture
def records(monkeypatch):
    from src.database import Base, engine, SessionLocal
    from src.models import JobCard, JobCardStage, SalesOrder, PackingRecord, QualityInspection
    from src.routers import operations as ops, dispatch as dispatch_api

    # Import Sales under its own package name so its real ORM and endpoint code
    # can participate in the same test without colliding with production's src.
    name = 'sales_shortage_contract'
    if name not in sys.modules:
        sales_url = os.getenv('SHORTAGE_SALES_DATABASE_URL', '')
        if 'hardening_test' not in sales_url:
            pytest.skip('SHORTAGE_SALES_DATABASE_URL must name an isolated hardening_test database')
        package = types.ModuleType(name)
        package.__path__ = [str(Path(__file__).resolve().parents[2] / 'sales-service' / 'src')]
        sys.modules[name] = package
        with monkeypatch.context() as env:
            env.setenv('DATABASE_URL', sales_url)
            importlib.import_module(name + '.database')
            importlib.import_module(name + '.models')
            importlib.import_module(name + '.routers.sales_orders')
            importlib.import_module(name + '.main')
    sales_dbmod = importlib.import_module(name + '.database')
    sales_models = importlib.import_module(name + '.models')
    sales_api = importlib.import_module(name + '.routers.sales_orders')
    from src import entry_models  # register entry/outbox tables before schema creation
    Base.metadata.create_all(engine)
    sales_dbmod.Base.metadata.create_all(sales_dbmod.engine)
    conn, sconn = engine.connect(), sales_dbmod.engine.connect()
    tx, stx = conn.begin(), sconn.begin()
    db = SessionLocal(bind=conn, join_transaction_mode='create_savepoint')
    sales = sales_dbmod.SessionLocal(bind=sconn, join_transaction_mode='create_savepoint')
    spec_id = uuid.uuid4()
    order = sales_models.SalesOrder(order_no='TEST-' + uuid.uuid4().hex[:16], plant_id=PLANT,
                customer_id=uuid.uuid4(), created_by='test', status=sales_models.SalesOrderStatus.RELEASED)
    sales.add(order); sales.flush()
    line = sales_models.SalesOrderLine(sales_order_id=order.id, approved_spec_id=spec_id,
                                      qty=100, fulfilled_qty=0, due_date=date.today())
    sales.add(line); sales.flush()
    local_order = SalesOrder(id=order.id, plant_id=uuid.UUID(PLANT), customer_id=order.customer_id,
                             spec_id=spec_id, order_qty=100, due_date=date.today())
    db.add(local_order); db.flush()
    job = JobCard(plant_id=uuid.UUID(PLANT), sales_order_id=order.id, sales_order_line_id=line.id,
                  spec_id=spec_id, job_card_no='TEST-' + uuid.uuid4().hex[:12], planned_qty=100,
                  released_qty=100, status='IN_PROGRESS', current_stage='DISPATCH',
                  spec_snapshot={'entry_model': 'V2', 'pcs_per_bamboo': 10, 'selected_bamboo_length_mm': 1560, 'released_planned_qty': 100,
                     'release_authorization_id': str(uuid.uuid4()), 'release_bundle_hash': 'frozen-hash',
                     'season': 'MONSOON', 'recipe_revision': 7, 'qc_profile': {'version': 4}},
                  routing_snapshot={'stages': ROUTE},
                  material_plan_snapshot={'planned_output_qty': 100, 'target_bamboo_count': 10,
                                         'recipe_snapshot': {'revision': 7, 'paper_layers': [1, 2]}})
    db.add(job); db.flush()
    lot = sales_models.SalesOrderReleaseLot(sales_order_id=order.id, sales_order_line_id=line.id,
                  released_qty=100, winder_machine_id=uuid.uuid4(), job_card_id=job.id,
                  product_code='TEST-TUBE', status='released')
    sales.add(lot); sales.flush(); job.release_lot_id = lot.id
    for stage in ROUTE:
        db.add(JobCardStage(job_card_id=job.id, stage_type=stage,
                           status='QUEUED' if stage == 'DISPATCH' else 'COMPLETED',
                           output_qty=40 if stage == 'QC' else 100))
    db.add(PackingRecord(job_card_id=job.id, plant_id=uuid.UUID(PLANT), total_packed_qty=100,
                         fg_item_id=uuid.uuid4(), snapshot={'inventory_batch_id': str(uuid.uuid4())}))
    db.add(QualityInspection(job_card_id=job.id, plant_id=uuid.UUID(PLANT), stage_type='QC', status='PASS', readings={}))
    db.commit(); sales.commit()
    monkeypatch.setattr(ops, '_validate_reason_code', lambda **kw: None)
    monkeypatch.setattr(sales_api, '_emit_lot_audit', lambda *a, **kw: None)
    # Sales audit transport is best effort and is not the contract under test.
    audit = importlib.import_module(name + '.utils.audit_client')
    monkeypatch.setattr(audit, 'emit_audit_event', lambda **kw: None)
    remote_calls = []
    lost = {'carry': 0, 'short': 0}

    def remote(url, *, json, **kwargs):
        remote_calls.append((url, deepcopy(json)))
        if url.endswith('/reallocate-carry-forward'):
            result = sales_api.reallocate_release_lot_carry_forward(
                uuid.UUID(url.split('/')[-2]), sales_api.ReleaseLotReallocatePayload(**json), sales, PLANT, USER)
            if lost['carry']:
                lost['carry'] -= 1
                raise httpx.ReadTimeout('Sales committed but its response was lost')
        elif url.endswith('/short-close'):
            result = sales_api.short_close_sales_order_line(
                uuid.UUID(url.split('/')[-2]), sales_api.SalesOrderLineShortClosePayload(**json), sales, PLANT, USER)
            if lost['short']:
                lost['short'] -= 1
                raise httpx.ReadTimeout('Sales committed but its response was lost')
        else:
            raise AssertionError(url)
        if hasattr(result, 'model_dump'): result = result.model_dump(mode='json')
        return httpx.Response(200, json=jsonable_encoder(result))

    def sales_dispatch(*, path, payload, **kwargs):
        if path.endswith('/validate-dispatch'):
            return sales_api.validate_dispatch_for_line(line.id, sales_api.DispatchValidationPayload(**payload), sales, SCOPE, USER)
        return sales_api.record_dispatch_for_line(line.id, sales_api.RecordDispatchPayload(**payload), sales, PLANT, USER)

    monkeypatch.setattr(ops.httpx, 'post', remote)
    monkeypatch.setattr(dispatch_api, '_post_sales_request', sales_dispatch)
    monkeypatch.setattr(dispatch_api, '_post_inventory_dispatch_if_needed', lambda **kw:
        {**kw['snapshot'], 'inventory_dispatch_status': 'POSTED', 'inventory_dispatch_transaction_id': str(uuid.uuid4())})
    yield db, sales, job, lot, line, ops, sales_api, dispatch_api, remote_calls, lost
    db.close(); sales.close(); tx.rollback(); stx.rollback(); conn.close(); sconn.close()


def decide(record, decision='CARRY_FORWARD', produced=40, **kwargs):
    db, _, job, _, _, ops, *_ = record
    payload = ops.ShortClosePayload(produced_qty=produced, reason_code='SHORT', decision=decision, **kwargs)
    return ops.short_close_job_card(job.id, payload, db, SCOPE, USER)


def ship(record, job, qty):
    db, _, _, _, _, _, _, api, *_ = record
    return api.create_or_update_dispatch(api.DispatchPayload(job_card_id=job.id, status='SEALED',
        dispatch_qty=qty, dispatch_request_id='shortage-' + str(job.id), dispatch_snapshot={}), db, PLANT, USER)


def test_shipped_parent_carries_only_qc_gap_and_child_fulfills_original_sales(records):
    from src.models import JobCard, JobCardStage, JobCardStageSegment, PackingRecord, QualityInspection
    from src.routers.entries import flow
    db, sales, parent, source_lot, line, ops, _, _, _, _ = records
    ship(records, parent, 40)
    assert parent.status == 'COMPLETED' and line.fulfilled_qty == 40
    frozen = deepcopy(parent.spec_snapshot)
    result = decide(records)
    child = db.get(JobCard, result.carry_forward_job_card_id)
    assert (result.planned_qty, result.produced_qty, result.gap_qty) == (100, 40, 60)
    assert (parent.planned_qty, parent.released_qty) == (100, 100)
    assert parent.spec_snapshot == frozen and parent.current_stage == 'DONE'
    assert (child.planned_qty, child.released_qty, child.parent_job_card_id, child.current_stage) == (60, 60, parent.id, 'WINDER')
    assert child.spec_snapshot == {**frozen, 'released_planned_qty': 60}
    assert child.material_plan_snapshot['target_bamboo_count'] == 6
    assert child.material_plan_snapshot['recipe_snapshot'] == parent.material_plan_snapshot['recipe_snapshot']
    stages = db.query(JobCardStage).filter_by(job_card_id=child.id).all()
    assert {s.stage_type for s in stages} == set(ROUTE)
    assert db.query(JobCardStageSegment).filter_by(job_card_id=child.id).count() == len(ROUTE)
    assert len(flow(db, child)['stages']) == len(ROUTE)
    sales.expire_all()
    lot_model = type(source_lot)
    child_lot = sales.get(lot_model, child.release_lot_id)
    assert child_lot.job_card_id == child.id and child_lot.sales_order_line_id == line.id
    assert child_lot.source_release_lot_id == source_lot.id
    assert source_lot.released_qty + child_lot.released_qty == 100
    assert decide(records).id == result.id
    assert db.query(JobCard).filter_by(parent_job_card_id=parent.id).count() == 1
    # Accepted replacement output goes through the same real dispatch and Sales
    # endpoints, exhausting the original order without double fulfillment.
    for stage in stages:
        stage.status = 'QUEUED' if stage.stage_type == 'DISPATCH' else 'COMPLETED'
        stage.output_qty = 60
    child.current_stage, child.status = 'DISPATCH', 'IN_PROGRESS'
    db.add(PackingRecord(job_card_id=child.id, plant_id=uuid.UUID(PLANT), total_packed_qty=60,
                         fg_item_id=uuid.uuid4(), snapshot={'inventory_batch_id': str(uuid.uuid4())}))
    db.add(QualityInspection(job_card_id=child.id, plant_id=uuid.UUID(PLANT), stage_type='QC', status='PASS', readings={}))
    db.commit()
    shipment = ship(records, child, 60)
    assert child.status == 'COMPLETED' and line.fulfilled_qty == 100 and line.qty == 100
    assert ship(records, child, 60).id == shipment.id and line.fulfilled_qty == 100


def test_sales_commit_lost_response_recreates_same_child_and_conserves_lots(records):
    from src.models import JobCard, JobCardStage
    db, sales, parent, lot, line, ops, _, _, calls, lost = records
    lost['carry'] = 1
    with pytest.raises(HTTPException) as error: decide(records)
    assert error.value.status_code == 502
    result = decide(records)
    carry_calls = [body for url, body in calls if url.endswith('reallocate-carry-forward')]
    assert carry_calls[0] == carry_calls[1]
    sales.expire_all()
    assert lot.released_qty == 40
    assert sum(row.released_qty for row in sales.query(type(lot)).filter_by(sales_order_line_id=line.id)) == 100
    assert db.query(JobCard).filter_by(parent_job_card_id=parent.id).count() == 1
    assert db.query(JobCardStage).filter_by(job_card_id=result.carry_forward_job_card_id).count() == len(ROUTE)
    assert parent.status == 'IN_PROGRESS' and parent.current_stage == 'DISPATCH'


def test_short_close_so_after_shipment_retries_lost_sales_response_without_double_reduction(records, monkeypatch):
    _, sales, parent, lot, line, ops, *_ = records
    ship(records, parent, 40)
    records[-1]['short'] = 1
    monkeypatch.setattr(ops.time, 'sleep', lambda seconds: None)
    result = decide(records, 'SHORT_CLOSE_SO')
    sales.expire_all()
    assert line.qty == line.fulfilled_qty == lot.released_qty == 40
    assert lot.status == 'short_closed' and parent.status == 'COMPLETED'
    assert decide(records, 'SHORT_CLOSE_SO').id == result.id
    assert line.qty == 40


@pytest.mark.parametrize('accepted', [0, 40])
def test_hold_after_physical_completion_resolves_to_frozen_carry_and_replays(records, accepted):
    from src.models import JobCardStage
    db, _, parent, _, _, ops, *_ = records
    if accepted:
        ship(records, parent, accepted)
    else:
        qc = db.query(JobCardStage).filter_by(job_card_id=parent.id, stage_type='QC').one()
        qc.output_qty = 0
        parent.status, parent.current_stage = 'COMPLETED', 'DONE'
        db.commit()
    hold = decide(records, 'HOLD', produced=accepted)
    resolved = ops.resolve_short_close_hold(hold.id, ops.ResolveHoldPayload(decision='CARRY_FORWARD', notes='approved replacement'), db, SCOPE, USER)
    assert resolved.hold_status == 'RESOLVED' and resolved.gap_qty == 100 - accepted
    assert ops.resolve_short_close_hold(hold.id, ops.ResolveHoldPayload(decision='CARRY_FORWARD', notes='approved replacement'), db, SCOPE, USER).id == resolved.id
    with pytest.raises(HTTPException) as error:
        ops.resolve_short_close_hold(hold.id, ops.ResolveHoldPayload(decision='SHORT_CLOSE_SO'), db, SCOPE, USER)
    assert error.value.status_code == 409


def test_decision_before_shipment_keeps_accepted_fg_pending_dispatch(records):
    parent = records[2]
    decide(records, 'SHORT_CLOSE_SO')
    assert (parent.status, parent.current_stage) == ('IN_PROGRESS', 'DISPATCH')
    ship(records, parent, 40)
    assert (parent.status, parent.current_stage) == ('COMPLETED', 'DONE')


@pytest.mark.parametrize('bad', ['quantity', 'upstream', 'scope', 'stage', 'repeat'])
def test_shortage_guards_are_authoritative(records, bad):
    from src.models import JobCardStage
    db, _, parent, _, _, ops, *_ = records
    if bad == 'quantity': request = lambda: decide(records, produced=39)
    elif bad == 'upstream':
        db.query(JobCardStage).filter_by(job_card_id=parent.id, stage_type='OVEN').one().status = 'RUNNING'
        db.commit(); request = lambda: decide(records)
    elif bad == 'scope':
        request = lambda: ops.short_close_job_card(parent.id, ops.ShortClosePayload(produced_qty=40, decision='HOLD', reason_code='SHORT'), db, {**SCOPE, 'selected_plant_id': str(uuid.uuid4())}, USER)
    elif bad == 'stage': request = lambda: decide(records, stage_type='QC')
    else:
        decide(records, 'HOLD'); request = lambda: decide(records, 'CARRY_FORWARD')
    with pytest.raises(HTTPException) as error: request()
    assert error.value.status_code in {404, 409, 422}


def test_sales_split_blocks_excess_and_foreign_line_replay(records):
    _, sales, parent, lot, _, _, api, *_ = records
    payload = api.ReleaseLotReallocatePayload(carry_forward_job_card_id=uuid.uuid4(), gap_qty=101)
    with pytest.raises(HTTPException) as error:
        api.reallocate_release_lot_carry_forward(lot.id, payload, sales, PLANT, USER)
    assert error.value.status_code == 409 and lot.released_qty == 100
    decide(records)
    with pytest.raises(HTTPException) as error:
        api.reallocate_release_lot_carry_forward(lot.id, payload.model_copy(update={'gap_qty': 60}), sales, 'OTHER-PLANT', USER)
    assert error.value.status_code == 404


def test_filtered_history_returns_only_the_requested_card(records):
    db, _, parent, _, _, ops, *_ = records
    result = decide(records, 'HOLD')
    rows = ops.list_short_closes(None, None, parent.id, db, SCOPE)
    assert [row.id for row in rows] == [result.id]
    assert ops.list_short_closes(None, None, uuid.uuid4(), db, SCOPE) == []


def test_replay_rejects_a_sibling_source_lot_on_the_same_sales_line(records):
    db, sales, parent, source, line, _, api, *_ = records
    result = decide(records)
    from src.models import JobCard
    child = db.get(JobCard, result.carry_forward_job_card_id)
    sibling = type(source)(sales_order_id=source.sales_order_id, sales_order_line_id=line.id,
        released_qty=60, winder_machine_id=source.winder_machine_id, job_card_id=uuid.uuid4(), status='released')
    sales.add(sibling); sales.commit()
    request = api.ReleaseLotReallocatePayload(carry_forward_job_card_id=child.id, gap_qty=60, release_lot_id=child.release_lot_id)
    assert api.reallocate_release_lot_carry_forward(source.id, request, sales, PLANT, USER)['source_release_lot_id'] == source.id
    with pytest.raises(HTTPException) as error:
        api.reallocate_release_lot_carry_forward(sibling.id, request, sales, PLANT, USER)
    assert error.value.status_code == 409 and sibling.released_qty == 60 and source.released_qty == 40


def test_historical_null_source_recovers_only_with_deterministic_parent_proof(records):
    db, sales, parent, source, line, _, api, *_ = records
    result = decide(records)
    from src.models import JobCard
    child = db.get(JobCard, result.carry_forward_job_card_id)
    child_lot = sales.get(type(source), child.release_lot_id)
    child_lot.source_release_lot_id = None
    sibling = type(source)(sales_order_id=source.sales_order_id, sales_order_line_id=line.id,
        released_qty=60, winder_machine_id=source.winder_machine_id, job_card_id=uuid.uuid4(), status='released')
    sales.add(sibling); sales.commit()
    request = api.ReleaseLotReallocatePayload(carry_forward_job_card_id=child.id, gap_qty=60, release_lot_id=child.release_lot_id)
    with pytest.raises(HTTPException) as error:
        api.reallocate_release_lot_carry_forward(sibling.id, request, sales, PLANT, USER)
    assert error.value.status_code == 409 and child_lot.source_release_lot_id is None
    result = api.reallocate_release_lot_carry_forward(source.id, request, sales, PLANT, USER)
    assert result['source_release_lot_id'] == source.id and source.released_qty == 40 and child_lot.released_qty == 60


def test_unprovable_historical_split_source_is_not_blindly_backfilled(records):
    _, sales, _, source, line, _, api, *_ = records
    historical = type(source)(sales_order_id=source.sales_order_id, sales_order_line_id=line.id,
        released_qty=60, winder_machine_id=source.winder_machine_id, job_card_id=uuid.uuid4(), status='released')
    sales.add(historical); sales.commit()
    request = api.ReleaseLotReallocatePayload(carry_forward_job_card_id=historical.job_card_id, gap_qty=60, release_lot_id=historical.id)
    with pytest.raises(HTTPException) as error:
        api.reallocate_release_lot_carry_forward(source.id, request, sales, PLANT, USER)
    assert error.value.status_code == 409 and historical.source_release_lot_id is None and source.released_qty == 100
