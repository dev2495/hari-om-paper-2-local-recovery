"""Persistent shipment history and retry checks against an isolated PostgreSQL DB."""
import os
import uuid
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

from src.database import Base, engine, SessionLocal
from src.models import SalesOrder, JobCard, PackingRecord, Dispatch, QualityInspection, PLANT_A_UUID
from src.routers.dispatch import DispatchPayload, create_or_update_dispatch


def test_two_partial_shipments_preserve_history_and_retry_original():
    Base.metadata.create_all(engine)
    conn = engine.connect()
    transaction = conn.begin()
    db = SessionLocal(bind=conn, join_transaction_mode='create_savepoint')
    try:
        order = SalesOrder(customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=100, due_date=date.today())
        db.add(order); db.flush()
        job = JobCard(sales_order_id=order.id, spec_id=order.spec_id, planned_qty=100, released_qty=100, status='IN_PROGRESS', current_stage='PACKING')
        db.add(job); db.flush()
        db.add(PackingRecord(job_card_id=job.id, total_packed_qty=100, fg_item_id=uuid.uuid4()))
        # The live dispatch gate requires a current passing final QC inspection.
        db.add(QualityInspection(plant_id=PLANT_A_UUID, job_card_id=job.id, stage_type='QC', status='PASS', readings={}))
        db.commit()
        calls = []
        def inventory(**kwargs):
            calls.append(kwargs['dispatch_qty'])
            return {**kwargs['snapshot'], 'inventory_dispatch_transaction_id':str(uuid.uuid4()), 'inventory_dispatch_status':'POSTED'}
        def send(qty, request_id):
            return create_or_update_dispatch(DispatchPayload(job_card_id=job.id, dispatch_snapshot={}, status='SEALED', dispatch_qty=qty, dispatch_request_id=request_id), db, str(PLANT_A_UUID), {'roles':['Admin'], 'token':'test', 'sub':'test'})
        with patch('src.routers.dispatch._post_inventory_dispatch_if_needed', side_effect=inventory):
            first_id = send(60, 'first-'+str(job.id)).id
            assert job.status == 'IN_PROGRESS'
            second_id = send(40, 'second-'+str(job.id)).id
            assert first_id != second_id
            assert job.status == 'COMPLETED'
            assert send(60, 'first-'+str(job.id)).id == first_id
            assert calls == [60, 40]
            assert db.query(Dispatch).filter_by(job_card_id=job.id, status='SEALED').count() == 2
            with pytest.raises(HTTPException) as rejected:
                send(1, 'third-'+str(job.id))
            assert rejected.value.status_code == 409
    finally:
        db.close(); transaction.rollback(); conn.close()


def test_interrupted_shipment_can_resume_from_persisted_original_command():
    Base.metadata.create_all(engine)
    conn = engine.connect()
    transaction = conn.begin()
    db = SessionLocal(bind=conn, join_transaction_mode='create_savepoint')
    try:
        order = SalesOrder(customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=100, due_date=date.today())
        db.add(order); db.flush()
        job = JobCard(sales_order_id=order.id, sales_order_line_id=uuid.uuid4(), spec_id=order.spec_id,
                      planned_qty=100, released_qty=100, status='IN_PROGRESS', current_stage='PACKING')
        db.add(job); db.flush()
        db.add(PackingRecord(job_card_id=job.id, total_packed_qty=100, fg_item_id=uuid.uuid4()))
        db.add(QualityInspection(plant_id=PLANT_A_UUID, job_card_id=job.id, stage_type='QC', status='PASS', readings={}))
        db.commit()
        request = DispatchPayload(job_card_id=job.id, status='SEALED', dispatch_request_id='resume-'+str(job.id),
                                  dispatch_snapshot={'items':[{'total_pcs':40}], 'date':date.today().isoformat()})
        inventory_id = str(uuid.uuid4())
        def inventory(**kwargs):
            return {**kwargs['snapshot'], 'inventory_dispatch_transaction_id':inventory_id, 'inventory_dispatch_status':'POSTED'}
        user = {'roles':['Owner'], 'token':'test', 'sub':'test'}
        with patch('src.routers.dispatch._post_inventory_dispatch_if_needed', side_effect=inventory), \
             patch('src.routers.dispatch._post_sales_request', side_effect=[{}, HTTPException(502, 'temporary sales failure')]):
            with pytest.raises(HTTPException):
                create_or_update_dispatch(request, db, str(PLANT_A_UUID), user)
        draft = db.query(Dispatch).filter_by(job_card_id=job.id, status='DRAFT').one()
        assert draft.dispatch_snapshot['orchestration_state'] == 'FAILED'
        assert draft.dispatch_snapshot['inventory_dispatch_transaction_id'] == inventory_id
        resume = DispatchPayload.model_validate(draft.dispatch_snapshot['seal_request'])
        assert resume.model_dump(mode='json') == request.model_dump(mode='json')
        def reused_inventory(**kwargs):
            assert kwargs['snapshot']['inventory_dispatch_transaction_id'] == inventory_id
            return kwargs['snapshot']
        with patch('src.routers.dispatch._post_inventory_dispatch_if_needed', side_effect=reused_inventory), \
             patch('src.routers.dispatch._post_sales_request', return_value={}):
            sealed = create_or_update_dispatch(resume, db, str(PLANT_A_UUID), user)
            assert sealed.status == 'SEALED' and sealed.id == draft.id
            assert create_or_update_dispatch(resume, db, str(PLANT_A_UUID), user).id == sealed.id
        assert db.query(Dispatch).filter_by(job_card_id=job.id).count() == 1
    finally:
        db.close(); transaction.rollback(); conn.close()
