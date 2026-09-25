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
