"""Cancel-shipment stock reversal (production cancel of a half-sealed challan, 3 Nov 2026)."""
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
from src.routers.dispatch import DispatchCreate, DispatchReverse, create_dispatch, reverse_dispatch
from src.services import get_batch_balance


def test_cancelled_shipment_puts_stock_and_reservation_back_once_and_is_never_replayed():
    Base.metadata.create_all(engine)
    connection = engine.connect(); transaction = connection.begin()
    db = SessionLocal(bind=connection, join_transaction_mode="create_savepoint")
    plant, line, order = "REVERSE-" + uuid.uuid4().hex[:12], uuid.uuid4(), uuid.uuid4()
    user = {"sub": "dispatch-test", "roles": ["Dispatch"], "token": ""}
    try:
        item = ItemMaster(plant_id=plant, item_code="FG-" + uuid.uuid4().hex[:12], name="FG", type="FINISHED_GOOD", uom="PCS")
        db.add(item); db.flush()
        batch = StockBatch(item_id=item.id, batch_no="FG-REV", received_qty=100, plant_id=plant, stock_status="UNRESTRICTED")
        db.add(batch); db.flush()
        db.add(StockTransaction(item_id=item.id, batch_id=batch.id, transaction_type=TransactionType.INWARD, qty_change=100,
                                reference_type=ReferenceType.INTERNAL, reference_id=uuid.uuid4(), plant_id=plant,
                                stock_status="UNRESTRICTED", effective_date=date.today()))
        reservation = Reservation(plant_id=plant, sales_order_id=order, sales_order_line_id=line, item_id=item.id, batch_id=batch.id,
                                  reserved_qty=60, consumed_qty=0, status=ReservationStatus.ACTIVE, created_by="test")
        db.add(reservation); db.commit()
        ref = "PROD-DISPATCH-BOX-" + uuid.uuid4().hex
        payload = DispatchCreate(item_id=item.id, batch_id=batch.id, qty=60, dispatch_ref="DC-REV", external_ref=ref,
                                 sales_order_line_id=line, sales_order_id=order, effective_date=date.today())
        with patch("src.routers.dispatch.emit_audit_event"):
            create_dispatch(payload, db, plant, user)
            assert reservation.status == ReservationStatus.CONSUMED and get_batch_balance(str(batch.id), db) == 40
            body = DispatchReverse(external_refs=[ref, "NEVER-POSTED"], reversal_ref="PROD-DISPATCH-CANCEL-1", reason_code="EC-OTHER", reason="Truck did not come")
            first = reverse_dispatch(body, db, plant, user)
            assert [r["status"] for r in first["results"]] == ["REVERSED", "NOT_POSTED"]
            assert get_batch_balance(str(batch.id), db) == 100
            assert reservation.consumed_qty == 0 and reservation.status == ReservationStatus.ACTIVE
            again = reverse_dispatch(body, db, plant, user)
            assert [r["status"] for r in again["results"]] == ["ALREADY_REVERSED", "NOT_POSTED"] and get_batch_balance(str(batch.id), db) == 100
            # A stale retry of the cancelled shipment never counts as "already posted".
            with pytest.raises(HTTPException) as replay:
                create_dispatch(payload, db, plant, user)
            assert replay.value.status_code == 409 and "cancelled" in replay.value.detail
            # Another plant cannot reverse it.
            other = reverse_dispatch(DispatchReverse(external_refs=[ref], reversal_ref="X"), db, "OTHER-" + plant, user)
            assert other["results"][0]["status"] == "NOT_POSTED"
    finally:
        db.close(); transaction.rollback(); connection.close()
