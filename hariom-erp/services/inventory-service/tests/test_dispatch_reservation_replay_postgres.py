"""A committed outward replays independently of the reservation it consumed."""
import os
import uuid
from datetime import date
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "procurement_test" not in os.getenv("DATABASE_URL", ""):
    pytest.skip("Requires isolated procurement_test PostgreSQL", allow_module_level=True)

from src.database import Base, engine, SessionLocal
from src.models import ItemMaster, StockBatch, StockTransaction, Reservation, ReservationStatus, TransactionType, ReferenceType
from src.routers.dispatch import DispatchCreate, create_dispatch


def test_partial_reserved_shipment_replays_before_current_reservation_balance():
    Base.metadata.create_all(engine)
    connection = engine.connect(); transaction = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode="create_savepoint")
    plant, line, order = "REPLAY-" + uuid.uuid4().hex[:12], uuid.uuid4(), uuid.uuid4()
    user = {"sub": "dispatch-test", "roles": ["Dispatch"], "token": ""}
    try:
        item = ItemMaster(plant_id=plant, item_code="FG-" + uuid.uuid4().hex[:12], name="FG", type="FINISHED_GOOD", uom="PCS")
        db.add(item); db.flush()
        batch = StockBatch(item_id=item.id, batch_no="FG-TEST", received_qty=100, plant_id=plant, stock_status="UNRESTRICTED")
        db.add(batch); db.flush()
        db.add(StockTransaction(item_id=item.id, batch_id=batch.id, transaction_type=TransactionType.INWARD, qty_change=100,
                                reference_type=ReferenceType.INTERNAL, reference_id=uuid.uuid4(), plant_id=plant,
                                stock_status="UNRESTRICTED", effective_date=date.today()))
        reservation = Reservation(plant_id=plant, sales_order_id=order, sales_order_line_id=line,
                                  item_id=item.id, batch_id=batch.id, reserved_qty=100, consumed_qty=0,
                                  status=ReservationStatus.ACTIVE, created_by="test")
        db.add(reservation); db.commit()
        payload = DispatchCreate(item_id=item.id, batch_id=batch.id, qty=60, dispatch_ref="DC-TEST",
                                  external_ref="REPLAY-" + uuid.uuid4().hex, sales_order_line_id=line,
                                  sales_order_id=order, effective_date=date.today())
        with patch("src.routers.dispatch.emit_audit_event"):
            first = create_dispatch(payload, db, plant, user)
            assert reservation.consumed_qty == 60 and reservation.status == ReservationStatus.ACTIVE
            replay_ref = create_dispatch(payload, db, plant, user)
            replay_id = create_dispatch(payload.model_copy(update={"existing_transaction_id": first.transaction_id}), db, plant, user)
            assert first.transaction_id == replay_ref.transaction_id == replay_id.transaction_id
            assert reservation.consumed_qty == 60
            assert db.query(StockTransaction).filter_by(transaction_type=TransactionType.DISPATCH, item_id=item.id).count() == 1
            with pytest.raises(HTTPException) as error:
                create_dispatch(payload.model_copy(update={"qty": 30}), db, plant, user)
            assert error.value.status_code == 409
    finally:
        db.close(); transaction.rollback(); connection.close()
