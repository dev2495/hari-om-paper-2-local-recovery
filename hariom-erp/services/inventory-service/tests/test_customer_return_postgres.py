"""Customer returns: dispatch-checked quantity, stepwise dispositions and ledger status sync."""
import os
import uuid
from datetime import date

import pytest

if 'procurement_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated procurement_test database', allow_module_level=True)

from fastapi import HTTPException
from sqlalchemy import func

from src.database import SessionLocal
from src.models import CustomerRejection, ItemMaster, ReferenceType, StockBatch, StockTransaction, TransactionType
from src.routers.fg_inward import ManualFGInwardCreate, create_manual_fg_inward
from src.routers.quality import (
    CustomerRejectionCreate,
    CustomerRejectionDisposition,
    create_customer_rejection,
    dispose_customer_rejection,
    lookup_dispatch_for_return,
)

PLANT = '00000000-0000-0000-0000-0000000000a1'
STORE = {'sub': 'store-keeper', 'roles': ['Store']}
QC = {'sub': 'qc-inspector', 'roles': ['QC']}
OWNER = {'sub': 'owner-2', 'roles': ['Owner']}


def _shipped(db, qty=100.0):
    item = ItemMaster(item_code=f'FG-RET-{uuid.uuid4().hex[:8]}', name='Return test tube', type='FINISHED_GOOD',
        tracking_mode='BULK', uom='PCS', plant_id=PLANT, active='true')
    db.add(item); db.flush()
    batch = StockBatch(item_id=item.id, batch_no=uuid.uuid4().hex[:12], received_qty=qty, plant_id=PLANT, stock_status='UNRESTRICTED')
    db.add(batch); db.flush()
    job_id = uuid.uuid4()
    db.add(StockTransaction(item_id=item.id, batch_id=batch.id, plant_id=PLANT, transaction_type=TransactionType.FG_INWARD,
        qty_change=qty, stock_status='UNRESTRICTED', reference_type=ReferenceType.PRODUCTION_JOB, reference_id=job_id))
    dispatch_ref = f'DC-{uuid.uuid4().hex[:6]}'
    db.add(StockTransaction(item_id=item.id, batch_id=batch.id, plant_id=PLANT, transaction_type=TransactionType.DISPATCH,
        qty_change=-qty, stock_status='UNRESTRICTED', reference_type=ReferenceType.DISPATCH,
        reference_id=uuid.uuid5(uuid.NAMESPACE_URL, dispatch_ref),
        movement_metadata={'dispatch_ref': dispatch_ref, 'production_job_id': str(job_id)}))
    db.commit()
    return item, dispatch_ref, job_id


def _balance_by_status(db, batch_id):
    db.expire_all()
    rows = (db.query(StockTransaction.stock_status, func.sum(StockTransaction.qty_change))
        .filter(StockTransaction.batch_id == batch_id).group_by(StockTransaction.stock_status).all())
    return {status: round(float(qty), 6) for status, qty in rows if abs(float(qty or 0)) > 1e-9}


def test_return_is_checked_against_dispatch_and_follows_dispositions():
    with SessionLocal() as db:
        item, ref, job_id = _shipped(db)
        found = lookup_dispatch_for_return(dispatch_ref=ref, item_id=None, db=db, plant_id=PLANT, current_user=STORE)
        assert found['found'] and found['lines'][0]['returnable_qty'] == 100

        first = create_customer_rejection(CustomerRejectionCreate(item_id=item.id, rejected_qty=60, customer_name='Acme',
            dispatch_ref=ref, reason_code='CUSTOMER_REJECT'), db, PLANT, STORE)
        assert first.status == 'QC_HOLD' and first.trace_snapshot['dispatch_verified'] is True
        assert str(first.source_job_card_id) == str(job_id)
        with pytest.raises(HTTPException) as too_many:
            create_customer_rejection(CustomerRejectionCreate(item_id=item.id, rejected_qty=50, customer_name='Acme',
                dispatch_ref=ref, reason_code='CUSTOMER_REJECT'), db, PLANT, STORE)
        assert too_many.value.status_code == 409 and too_many.value.detail['code'] == 'RETURN_EXCEEDS_DISPATCH'

        # Rework is a step: the case stays open and the stock moves to WIP in the ledger too.
        step = dispose_customer_rejection(first.id, CustomerRejectionDisposition(disposition='REWORK', notes='Re-cut ends'), db, PLANT, QC)
        assert step.closed_at is None and step.closure_status == 'IN_PROGRESS' and step.status == 'WIP'
        assert _balance_by_status(db, first.batch_id) == {'WIP': 60.0}

        done = dispose_customer_rejection(first.id, CustomerRejectionDisposition(disposition='ACCEPT', notes='Reworked and checked'), db, PLANT, QC)
        assert done.closed_at is not None and done.status == 'UNRESTRICTED'
        assert _balance_by_status(db, first.batch_id) == {'UNRESTRICTED': 60.0}
        history = [row['disposition'] for row in done.trace_snapshot['disposition_history']]
        assert history == ['REWORK', 'ACCEPT']
        with pytest.raises(HTTPException):
            dispose_customer_rejection(first.id, CustomerRejectionDisposition(disposition='SCRAP', notes='late'), db, PLANT, QC)


def test_scrapped_return_leaves_no_held_quantity():
    with SessionLocal() as db:
        item, ref, _ = _shipped(db, qty=40)
        row = create_customer_rejection(CustomerRejectionCreate(item_id=item.id, rejected_qty=40, customer_name='Acme',
            dispatch_ref=ref, reason_code='CUSTOMER_REJECT'), db, PLANT, STORE)
        scrapped = dispose_customer_rejection(row.id, CustomerRejectionDisposition(disposition='SCRAP', notes='Crushed in transit'), db, PLANT, QC)
        assert scrapped.closed_at is not None
        balances = _balance_by_status(db, row.batch_id)
        assert abs(sum(balances.values())) < 1e-9 and not balances.get('QC_HOLD')


def test_unknown_dispatch_is_logged_unverified_and_side_doors_are_closed():
    with SessionLocal() as db:
        item, _, _ = _shipped(db, qty=10)
        row = create_customer_rejection(CustomerRejectionCreate(item_id=item.id, rejected_qty=5, customer_name='Legacy buyer',
            dispatch_ref='OLD-PAPER-DC-1', reason_code='CUSTOMER_REJECT'), db, PLANT, STORE)
        assert row.trace_snapshot['dispatch_verified'] is False
        with pytest.raises(HTTPException) as manual:
            create_manual_fg_inward(ManualFGInwardCreate(item_id=item.id, qty=5, reason_code='RETURN'), db, PLANT, OWNER)
        assert manual.value.status_code == 400
        assert db.query(CustomerRejection).filter_by(id=row.id).one().status == 'QC_HOLD'


def test_quality_analytics_reports_returns_by_customer_and_reason():
    from src.routers.quality import quality_analytics
    with SessionLocal() as db:
        item, ref, _ = _shipped(db, qty=20)
        create_customer_rejection(CustomerRejectionCreate(item_id=item.id, rejected_qty=7, customer_name='Analytics Co',
            dispatch_ref=ref, reason_code='CRUSHED'), db, PLANT, STORE)
        report = quality_analytics(date_from=None, date_to=None, db=db,
            plant_scope={'scope_all': False, 'selected_plant_id': PLANT, 'allowed_plants': [PLANT]}, current_user=QC)
        customer = next(row for row in report['customer_returns']['by_customer'] if row['customer'] == 'Analytics Co')
        assert customer['qty'] >= 7 and customer['open'] >= 1
        assert any(row['reason_code'] == 'CRUSHED' for row in report['customer_returns']['by_reason'])
        assert 'by_supplier' in report['incoming'] and 'first_pass_rate' in report['incoming']
