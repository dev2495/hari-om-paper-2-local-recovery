"""An approved spec revision takes over open order lines that have nothing released (isolated PostgreSQL)."""
import os
import uuid
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

import src.main  # noqa: F401  create_all + startup DDL
from src.database import SessionLocal
from src.models import SalesOrder, SalesOrderLine, SalesOrderStatus
from src.routers import sales_orders as so

USER = {'sub': 'owner@test', 'roles': ['Owner'], 'token': ''}
PLANT = 'PLANT-SUPERSEDE-TEST'


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _line(db, spec_id):
    order = so.create_sales_order(so.SalesOrderCreate(
        customer_id=uuid.uuid4(), origin='CUSTOMER_PO', po_number=f'SUP-{uuid.uuid4().hex[:6]}', po_date=date.today(),
        lines=[so.SalesOrderLineInput(approved_spec_id=spec_id, product_code='T120', size_label='120x133x125', parchment_required=False, qty=1000,
            due_date=date.today() + timedelta(days=10))],
    ), db=db, plant_id=PLANT, current_user=USER)
    db.get(SalesOrder, uuid.UUID(str(order['id']))).status = SalesOrderStatus.APPROVED
    db.commit()
    return uuid.UUID(str(order['lines'][0]['id']))


def test_unreleased_lines_move_to_the_approved_revision_and_repeat_is_a_noop(db):
    old, new = uuid.uuid4(), uuid.uuid4()
    line = _line(db, old)
    moved = so.supersede_spec_on_open_lines(so.SpecSupersedePayload(from_spec_id=old, to_spec_id=new), db=db, plant_id=PLANT, current_user=USER)
    assert moved['moved'] == 1 and moved['lines'] == [str(line)]
    db.expire_all()
    assert db.get(SalesOrderLine, line).approved_spec_id == new
    again = so.supersede_spec_on_open_lines(so.SpecSupersedePayload(from_spec_id=old, to_spec_id=new), db=db, plant_id=PLANT, current_user=USER)
    assert again['moved'] == 0


def test_a_lot_production_never_picked_up_follows_the_line(db):
    old, new = uuid.uuid4(), uuid.uuid4()
    line = _line(db, old)
    so.bulk_release_sales_order_lines([so.BulkReleaseLinePayload(line_id=line, release_qty=400, winder_machine_id=uuid.uuid4())], db=db, plant_id=PLANT, current_user=USER)
    moved = so.supersede_spec_on_open_lines(so.SpecSupersedePayload(from_spec_id=old, to_spec_id=new), db=db, plant_id=PLANT, current_user=USER)
    assert moved['moved'] == 1
    db.expire_all()
    assert db.get(SalesOrderLine, line).approved_spec_id == new


def test_a_line_already_released_to_production_blocks_the_revision(db):
    from src.models import SalesOrderReleaseLot
    old, new = uuid.uuid4(), uuid.uuid4()
    line = _line(db, old)
    so.bulk_release_sales_order_lines([so.BulkReleaseLinePayload(line_id=line, release_qty=400, winder_machine_id=uuid.uuid4())], db=db, plant_id=PLANT, current_user=USER)
    lot = db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.sales_order_line_id == line).one()
    lot.job_card_id = uuid.uuid4()  # production built a job card from the current version
    db.commit()
    with pytest.raises(HTTPException) as err:
        so.supersede_spec_on_open_lines(so.SpecSupersedePayload(from_spec_id=old, to_spec_id=new), db=db, plant_id=PLANT, current_user=USER)
    assert err.value.status_code == 409 and err.value.detail['code'] == 'SPEC_IN_PRODUCTION'
    db.rollback(); db.expire_all()
    assert db.get(SalesOrderLine, line).approved_spec_id == old


def test_other_plants_lines_are_never_touched(db):
    old, new = uuid.uuid4(), uuid.uuid4()
    line = _line(db, old)
    result = so.supersede_spec_on_open_lines(so.SpecSupersedePayload(from_spec_id=old, to_spec_id=new), db=db, plant_id='PLANT-SOMEWHERE-ELSE', current_user=USER)
    assert result['moved'] == 0
    db.expire_all()
    assert db.get(SalesOrderLine, line).approved_spec_id == old
