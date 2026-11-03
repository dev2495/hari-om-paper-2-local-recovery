"""Stuck release lots and plant isolation (review 3 Nov 2026, isolated PostgreSQL).

* A lot saved in sales whose job card never came back (planning sync failed) does not keep the order
  from being cancelled or short-closed; the lot is cancelled with it and cannot be linked later.
* A record of another plant is "not found", and order writes need the order's own concrete plant.
"""
import os
import uuid
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

import src.main  # noqa: F401  create_all + startup DDL
from src.database import SessionLocal
from src.models import SalesOrder, SalesOrderReleaseLot, SalesOrderStatus
from src.routers import release_returns as rr
from src.routers import sales_orders as so

USER = {'sub': 'admin.salesfix@test', 'roles': ['Admin'], 'token': ''}
PLANT = 'PLANT-SALESFIX-A'
OTHER = 'PLANT-SALESFIX-B'


def scope(plant):
    return {'scope_all': False, 'selected_plant_id': plant, 'allowed_plants': [plant], 'is_owner': False}


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _approved_order(db, qty=1000):
    order = so.create_sales_order(so.SalesOrderCreate(
        customer_id=uuid.uuid4(), origin='CUSTOMER_PO', po_number=f'SFX-{uuid.uuid4().hex[:6]}', po_date=date.today(),
        lines=[so.SalesOrderLineInput(approved_spec_id=uuid.uuid4(), product_code='SFX1', size_label='76x100', qty=qty, parchment_required=True,
                                      color_splits=[so.LineColorInput(color='Blue', qty=qty)],
                                      due_date=date.today() + timedelta(days=10))],
    ), db=db, plant_id=PLANT, current_user=USER)
    db.get(SalesOrder, uuid.UUID(str(order['id']))).status = SalesOrderStatus.APPROVED
    db.commit()
    return uuid.UUID(str(order['id'])), uuid.UUID(str(order['lines'][0]['id']))


def _release(db, line_id, qty, *, linked: bool, age=timedelta(hours=2)):
    lot_id = uuid.uuid4()
    so.bulk_release_sales_order_lines([so.BulkReleaseLinePayload(line_id=line_id, release_qty=qty, winder_machine_id=uuid.uuid4(), release_lot_id=lot_id, parchment_color='Blue')],
                                      db=db, plant_id=PLANT, current_user=USER)
    if linked:
        so.sync_release_lot_job_card(lot_id, so.ReleaseLotJobCardSyncPayload(job_card_id=uuid.uuid4()), db=db, plant_id=PLANT, current_user=USER)
    lot = db.get(SalesOrderReleaseLot, lot_id)
    lot.created_at = datetime.utcnow() - age
    db.commit()
    return lot_id


def _closure(code='SO-CUSTOMER-CANCELLED'):
    return so.SalesOrderClosurePayload(reason_code=code)


def test_order_with_only_a_stuck_lot_can_be_cancelled_and_the_lot_goes_with_it(db):
    order_id, line_id = _approved_order(db)
    lot_id = _release(db, line_id, 400, linked=False)
    options = so.get_sales_order(order_id, db=db, plant_scope=scope(PLANT), current_user=USER)['closure_options']
    assert options['cancel']['allowed'] and options['stuck_qty'] == 400
    result = so.cancel_sales_order(order_id, _closure(), db=db, plant_id=PLANT, current_user=USER)
    assert result['status'] == 'cancelled'
    db.expire_all()
    assert db.get(SalesOrderReleaseLot, lot_id).status == 'cancelled'
    # A late planning sync cannot link a card to the cancelled lot.
    with pytest.raises(HTTPException) as late:
        so.sync_release_lot_job_card(lot_id, so.ReleaseLotJobCardSyncPayload(job_card_id=uuid.uuid4()), db=db, plant_id=PLANT, current_user=USER)
    assert late.value.status_code == 409


def test_a_lot_released_a_minute_ago_still_blocks_cancel(db):
    order_id, line_id = _approved_order(db)
    _release(db, line_id, 400, linked=False, age=timedelta(minutes=1))
    with pytest.raises(HTTPException) as refused:
        so.cancel_sales_order(order_id, _closure(), db=db, plant_id=PLANT, current_user=USER)
    assert refused.value.status_code == 409


def test_short_close_drops_the_stuck_lot_and_keeps_the_real_job_card(db):
    order_id, line_id = _approved_order(db)
    linked = _release(db, line_id, 300, linked=True)
    stuck = _release(db, line_id, 200, linked=False)
    so.short_close_sales_order(order_id, _closure(), db=db, plant_id=PLANT, current_user=USER)
    db.expire_all()
    assert db.get(SalesOrderReleaseLot, stuck).status == 'cancelled'
    assert db.get(SalesOrderReleaseLot, linked).status != 'cancelled'
    order = so.get_sales_order(order_id, db=db, plant_scope=scope(PLANT), current_user=USER)
    assert order['lines'][0]['qty'] == 300 and order['lines'][0]['short_closed_qty'] == 700


def test_another_plants_order_line_and_lot_are_not_found(db):
    order_id, line_id = _approved_order(db)
    lot_id = _release(db, line_id, 300, linked=True)
    calls = [
        lambda: so.get_sales_order(order_id, db=db, plant_scope=scope(OTHER), current_user=USER),
        lambda: so.get_sales_order_line(line_id, db=db, plant_scope=scope(OTHER), current_user=USER),
        lambda: so.get_order_delivery_schedules(order_id, db=db, plant_scope=scope(OTHER), current_user=USER),
        lambda: so.get_sales_order_timeline(order_id, db=db, plant_scope=scope(OTHER), current_user=USER),
        lambda: rr.list_stage_returns(lot_id, db=db, plant_id=OTHER, current_user=USER),
        lambda: so.amend_release_lot(lot_id, so.ReleaseLotAmendPayload(job_card_id=uuid.uuid4(), release_qty=100), db=db, plant_id=OTHER, current_user=USER),
        lambda: so.commit_order_delivery_schedules(order_id, so.DeliveryScheduleCommitPayload(rows=[so.DeliveryScheduleRowInput(line_id=line_id, delivery_date=date.today() + timedelta(days=5), quantity=100)]),
                                                   db=db, plant_id=OTHER, current_user=USER),
        lambda: so.cancel_sales_order(order_id, _closure(), db=db, plant_id=OTHER, current_user=USER),
        lambda: so.hold_sales_order(order_id, so.SalesOrderHoldPayload(reason_code='SO-CUSTOMER-HOLD'), db=db, plant_id=OTHER, current_user=USER),
    ]
    for call in calls:
        with pytest.raises(HTTPException) as refused:
            call()
        assert refused.value.status_code == 404
        db.rollback()
    # The own plant still sees the lot's returns.
    assert rr.list_stage_returns(lot_id, db=db, plant_id=PLANT, current_user=USER) == []
