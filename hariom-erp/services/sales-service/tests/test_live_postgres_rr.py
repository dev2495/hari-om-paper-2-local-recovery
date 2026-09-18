"""Live overlapping schedule commits and 100/40/60 conservation."""
from __future__ import annotations

import os
import threading
import uuid
from datetime import date, timedelta

import pytest

URL = os.environ.get("HARI_OM_SALES_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify sales Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from src.database import Base, engine
from src.models import SalesOrder, SalesOrderDeliverySchedule, SalesOrderLine, SalesOrderOrigin, SalesOrderStatus
from src.schedule_service import commit_entire_po, mutate_schedule_row


Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _order(db, qty=100.0, fulfilled=0.0, token=None) -> SalesOrder:
    token = token or uuid.uuid4().hex[:8]
    po_date = date.today()
    order = SalesOrder(
        order_no=f"NV-SO-{token}",
        plant_id="PLANT-1",
        customer_id=uuid.uuid4(),
        origin=SalesOrderOrigin.CUSTOMER_PO.value,
        po_number=f"PO-{token}",
        po_date=po_date,
        status=SalesOrderStatus.APPROVED,
        created_by="sales-1",
        schedule_revision=0,
    )
    db.add(order)
    db.flush()
    line = SalesOrderLine(
        sales_order_id=order.id,
        line_no=1,
        approved_spec_id=uuid.uuid4(),
        qty=qty,
        due_date=po_date + timedelta(days=14),
        fulfilled_qty=fulfilled,
    )
    db.add(line)
    db.flush()
    db.refresh(order)
    return order


def test_schedule_100_with_existing_40_appends_60():
    db = Session()
    try:
        order = _order(db, qty=100, fulfilled=0)
        line = order.lines[0]
        existing = SalesOrderDeliverySchedule(
            sales_order_id=order.id,
            sales_order_line_id=line.id,
            plant_id=order.plant_id,
            delivery_date=date.today() + timedelta(days=7),
            quantity=40,
            status="committed",
            revision=1,
        )
        db.add(existing)
        db.commit()
        db.refresh(order)
        result = commit_entire_po(
            db,
            order=order,
            expected_revision=0,
            actor="owner-1",
            default_date=line.due_date,
        )
        db.commit()
        rows = db.query(SalesOrderDeliverySchedule).filter(SalesOrderDeliverySchedule.sales_order_id == order.id).all()
        assert len(rows) == 2
        quantities = sorted(float(row.quantity) for row in rows)
        assert quantities == [40.0, 60.0]
        kept = db.query(SalesOrderDeliverySchedule).filter(SalesOrderDeliverySchedule.id == existing.id).one()
        assert kept.quantity == 40
        db.refresh(order)
        assert int(order.schedule_revision) == 1
        assert result["merge_mode"] == "append"
    finally:
        db.close()


def test_fulfilled_40_caps_new_commitment_at_60():
    db = Session()
    try:
        order = _order(db, qty=100, fulfilled=40)
        db.commit()
        db.refresh(order)
        commit_entire_po(db, order=order, expected_revision=0, actor="owner-1", default_date=order.lines[0].due_date)
        db.commit()
        rows = db.query(SalesOrderDeliverySchedule).filter(SalesOrderDeliverySchedule.sales_order_id == order.id).all()
        assert abs(sum(float(row.quantity) for row in rows) - 60.0) < 1e-9
    finally:
        db.close()


def test_patch_cannot_fake_delivered():
    db = Session()
    try:
        order = _order(db, qty=100)
        db.commit()
        commit_entire_po(db, order=order, expected_revision=0, actor="owner-1", default_date=order.lines[0].due_date)
        db.commit()
        row = db.query(SalesOrderDeliverySchedule).filter(SalesOrderDeliverySchedule.sales_order_id == order.id).one()
        with pytest.raises(HTTPException) as blocked:
            mutate_schedule_row(
                db,
                order=order,
                schedule_id=row.id,
                updates={"status": "delivered"},
                actor="owner-1",
            )
        assert blocked.value.status_code == 400
        assert "Delivered" in str(blocked.value.detail)
    finally:
        db.close()


def test_overlapping_schedule_commits_reject_stale_revision():
    db = Session()
    try:
        order = _order(db, qty=100)
        db.commit()
        order_id = order.id
    finally:
        db.close()

    barrier = threading.Barrier(2)
    results: list[object] = []
    lock = threading.Lock()

    def _worker_session():
        worker_engine = create_engine(URL, poolclass=NullPool)
        return sessionmaker(bind=worker_engine, autoflush=False, autocommit=False)()

    def worker() -> None:
        session = _worker_session()
        try:
            current = session.query(SalesOrder).filter(SalesOrder.id == order_id).one()
            barrier.wait(timeout=10)
            commit_entire_po(session, order=current, expected_revision=0, actor="owner-1", default_date=current.lines[0].due_date)
            session.commit()
            with lock:
                results.append(("ok", 1))
        except HTTPException as exc:
            session.rollback()
            with lock:
                results.append(("err", exc.status_code, exc.detail))
        except Exception as exc:
            session.rollback()
            with lock:
                results.append(("exc", type(exc).__name__, str(exc)))
        finally:
            session.close()

    threads = [threading.Thread(target=worker), threading.Thread(target=worker)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    ok = [row for row in results if row[0] == "ok"]
    err = [row for row in results if row[0] == "err"]
    assert len(ok) == 1, results
    assert len(err) == 1, results
    assert err[0][1] == 409
    check = Session()
    try:
        stored = check.query(SalesOrder).filter(SalesOrder.id == order_id).one()
        assert int(stored.schedule_revision) == 1
        qty = sum(
            float(row.quantity)
            for row in check.query(SalesOrderDeliverySchedule).filter(SalesOrderDeliverySchedule.sales_order_id == order_id)
        )
        assert abs(qty - 100.0) < 1e-9
    finally:
        check.close()
