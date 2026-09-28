"""Bulk release is all or nothing (isolated PostgreSQL)."""
import os
import uuid
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)

import src.main  # noqa: F401  create_all + startup DDL
from src.database import SessionLocal
from src.models import SalesOrder, SalesOrderReleaseLot, SalesOrderStatus
from src.routers import sales_orders as so

USER = {'sub': 'planner@test', 'roles': ['Admin'], 'token': ''}
PLANT = 'PLANT-BULK-TEST'


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _approved_line(db):
    order = so.create_sales_order(so.SalesOrderCreate(
        customer_id=uuid.uuid4(), origin='CUSTOMER_PO', po_number=f'BULK-{uuid.uuid4().hex[:6]}', po_date=date.today(),
        lines=[so.SalesOrderLineInput(approved_spec_id=uuid.uuid4(), product_code='T135', size_label='135x120', parchment_required=True, qty=5000,
            due_date=date.today() + timedelta(days=10), color_splits=[so.LineColorInput(color='Blue', qty=2000), so.LineColorInput(color='Red', qty=1000)])],
    ), db=db, plant_id=PLANT, current_user=USER)
    db.get(SalesOrder, uuid.UUID(str(order['id']))).status = SalesOrderStatus.APPROVED
    db.commit()
    return uuid.UUID(str(order['lines'][0]['id']))


def _row(line_id, qty, color, lot_id=None):
    return so.BulkReleaseLinePayload(line_id=line_id, release_qty=qty, winder_machine_id=uuid.uuid4(), parchment_color=color, release_lot_id=lot_id)


def _lots(db, line_id):
    db.expire_all()
    return db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.sales_order_line_id == line_id).count()


def test_bulk_release_with_one_bad_row_releases_nothing(db):
    line = _approved_line(db)
    with pytest.raises(HTTPException) as error:
        so.bulk_release_sales_order_lines([_row(line, 2000, 'Blue'), _row(line, 1000, 'Red'), _row(line, 9000, 'Green')], db=db, plant_id=PLANT, current_user=USER)
    assert 'Row 3' in error.value.detail and 'Nothing was released' in error.value.detail
    assert _lots(db, line) == 0


def test_bulk_release_creates_every_lot_and_a_retry_does_not_duplicate(db):
    line = _approved_line(db)
    rows = [_row(line, 2000, 'Blue', uuid.uuid4()), _row(line, 1000, 'Red', uuid.uuid4())]
    first = so.bulk_release_sales_order_lines(rows, db=db, plant_id=PLANT, current_user=USER)
    assert first['count'] == 2 and _lots(db, line) == 2
    again = so.bulk_release_sales_order_lines(rows, db=db, plant_id=PLANT, current_user=USER)
    assert {lot['id'] for lot in again['lots']} == {lot['id'] for lot in first['lots']} and _lots(db, line) == 2
