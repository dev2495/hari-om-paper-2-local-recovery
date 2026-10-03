"""Exact fulfillment replay remains valid after commercial balance/order closure."""
import os
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

if "hardening_test" not in os.getenv("DATABASE_URL", ""):
    pytest.skip("Requires isolated hardening_test PostgreSQL", allow_module_level=True)

from src.database import Base, engine, SessionLocal
from src.models import SalesOrder, SalesOrderLine, SalesOrderDispatchLog, SalesOrderStatus
from src.routers.sales_orders import DispatchValidationPayload, RecordDispatchPayload, validate_dispatch_for_line, record_dispatch_for_line


@pytest.fixture
def records():
    Base.metadata.create_all(engine)
    connection = engine.connect(); transaction = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode="create_savepoint")
    plant = "DISPATCH-TEST-" + uuid.uuid4().hex[:10]
    order = SalesOrder(order_no="TEST-" + uuid.uuid4().hex[:15], plant_id=plant, customer_id=uuid.uuid4(),
                       created_by="test", status=SalesOrderStatus.RELEASED)
    db.add(order); db.flush()
    first = SalesOrderLine(sales_order_id=order.id, approved_spec_id=uuid.uuid4(), qty=100, fulfilled_qty=0, due_date=date.today())
    other = SalesOrderLine(sales_order_id=order.id, approved_spec_id=uuid.uuid4(), qty=100, fulfilled_qty=0, due_date=date.today(), line_no=2)
    db.add_all([first, other]); db.flush()
    yield db, plant, order, first, other
    db.close(); transaction.rollback(); connection.close()


def test_exact_replay_passes_after_sales_commit_and_order_closure(records):
    db, plant, order, line, other = records
    ref = "DISPATCH-REQUEST:" + uuid.uuid4().hex
    request = RecordDispatchPayload(qty=100, dispatch_line_ref=ref)
    user = {"roles": ["Dispatch"], "sub": "test"}
    record_dispatch_for_line(line.id, request, db, plant, user)
    # Simulate full order closure after other lines were also fulfilled.
    order.status = SalesOrderStatus.CLOSED; db.commit()
    scope = {"scope_all": False, "selected_plant_id": plant, "allowed_plants": [plant]}
    response = validate_dispatch_for_line(line.id, DispatchValidationPayload(qty=100, approved_spec_id=line.approved_spec_id, dispatch_line_ref=ref), db, scope, user)
    assert response["valid"] and response["remaining_qty"] == 0
    record_dispatch_for_line(line.id, request, db, plant, user)
    assert line.fulfilled_qty == 100 and db.query(SalesOrderDispatchLog).filter_by(line_id=line.id).count() == 1
    with pytest.raises(HTTPException) as error:
        validate_dispatch_for_line(line.id, DispatchValidationPayload(qty=1, dispatch_line_ref="NEW-REF"), db, scope, user)
    assert error.value.status_code == 400


@pytest.mark.parametrize("different_line", [False, True])
def test_reference_conflicts_for_another_line_or_quantity(records, different_line):
    db, plant, order, line, other = records
    ref = "REF-" + uuid.uuid4().hex
    user = {"roles": ["Dispatch"], "sub": "test"}
    record_dispatch_for_line(line.id, RecordDispatchPayload(qty=60, dispatch_line_ref=ref), db, plant, user)
    target = other if different_line else line
    qty = 60 if different_line else 40
    scope = {"scope_all": False, "selected_plant_id": plant, "allowed_plants": [plant]}
    for action in (
        lambda: record_dispatch_for_line(target.id, RecordDispatchPayload(qty=qty, dispatch_line_ref=ref), db, plant, user),
        lambda: validate_dispatch_for_line(target.id, DispatchValidationPayload(qty=qty, dispatch_line_ref=ref), db, scope, user),
    ):
        with pytest.raises(HTTPException) as error: action()
        assert error.value.status_code == 409
    assert line.fulfilled_qty == 60 and other.fulfilled_qty == 0
