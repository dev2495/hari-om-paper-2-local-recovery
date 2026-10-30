"""Owner and Admin may approve a sales order they entered themselves (user decision 30 Oct 2026).

Everyone else keeps maker-checker. The real (assigned) role decides, never the role a session acts as,
and the order history says "approved by the same person (Owner)".
"""
import os
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

import src.main  # noqa: F401  create_all + startup DDL
from src.database import SessionLocal
from src.routers import sales_orders as so

PLANT = 'PLANT-SELF-APPROVAL-TEST'
SCOPE = {'scope_all': False, 'selected_plant_id': PLANT}
OWNER = {'sub': 'owner.self@test', 'roles': ['Owner'], 'token': ''}
ADMIN = {'sub': 'admin.self@test', 'roles': ['Admin'], 'token': ''}
SALES = {'sub': 'sales.self@test', 'roles': ['Sales'], 'token': ''}
PLANNER = {'sub': 'planner.self@test', 'roles': ['Planner'], 'token': ''}
# An Owner whose session acts as Sales is still the Owner; a Sales user is never an Owner by acting.
OWNER_ACTING_SALES = {'sub': 'owner.acting@test', 'actual_sub': 'owner.acting@test', 'roles': ['Sales'], 'actual_roles': ['Owner'], 'token': ''}


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _order(db, maker):
    payload = so.SalesOrderCreate(
        customer_id=uuid.uuid4(),
        origin='CUSTOMER_PO',
        po_number=f'PO-{uuid.uuid4().hex[:6]}',
        po_date=date.today(),
        lines=[so.SalesOrderLineInput(approved_spec_id=uuid.uuid4(), product_code='SELF-1', size_label='76 x 100', qty=200)],
    )
    return so.create_sales_order(payload, db=db, plant_id=PLANT, current_user=maker)


def _approved_event(db, order_id, viewer):
    timeline = so.get_sales_order_timeline(uuid.UUID(str(order_id)), db=db, plant_scope=SCOPE, current_user=viewer)
    return next(row for row in timeline['events'] if row['event_type'] == 'SALES_ORDER_APPROVED')


@pytest.mark.parametrize('maker,role', [(OWNER, 'Owner'), (ADMIN, 'Admin'), (OWNER_ACTING_SALES, 'Owner')])
def test_owner_and_admin_approve_their_own_order_and_history_says_so(db, maker, role):
    order = _order(db, maker)
    result = so.approve_sales_order(uuid.UUID(str(order['id'])), db=db, plant_id=PLANT, current_user=maker)
    assert result['status'] == 'approved'
    event = _approved_event(db, order['id'], maker)
    assert event['title'] == f'Sales order approved by the same person ({role})'
    assert event['actor'] == maker['sub']
    assert event['metadata']['approved_as'] == role
    detail = so.get_sales_order(uuid.UUID(str(order['id'])), db=db, plant_scope=SCOPE, current_user=maker)
    assert detail['self_approved_role'] == role


@pytest.mark.parametrize('maker', [SALES, PLANNER])
def test_sales_and_planner_still_need_a_second_person(db, maker):
    order = _order(db, maker)
    with pytest.raises(HTTPException) as refused:
        so.approve_sales_order(uuid.UUID(str(order['id'])), db=db, plant_id=PLANT, current_user=maker)
    assert refused.value.status_code == 403
    assert 'same person cannot approve' in refused.value.detail
    assert 'Sign in as' not in refused.value.detail
    # A second person approves as before, and the history reads as a normal approval.
    so.approve_sales_order(uuid.UUID(str(order['id'])), db=db, plant_id=PLANT, current_user=OWNER)
    event = _approved_event(db, order['id'], OWNER)
    assert event['title'] == 'Sales order approved' and 'approved_as' not in event['metadata']
    detail = so.get_sales_order(uuid.UUID(str(order['id'])), db=db, plant_scope=SCOPE, current_user=OWNER)
    assert detail['self_approved_role'] is None


def test_a_sales_session_acting_cannot_borrow_an_owner_role(db):
    # roles say Owner but the real roles are Sales only (a forged or stale acting claim): still maker-checker.
    maker = {'sub': 'sales.acting@test', 'roles': ['Owner'], 'actual_roles': ['Sales'], 'token': ''}
    order = _order(db, maker)
    with pytest.raises(HTTPException) as refused:
        so.approve_sales_order(uuid.UUID(str(order['id'])), db=db, plant_id=PLANT, current_user=maker)
    assert refused.value.status_code == 403
