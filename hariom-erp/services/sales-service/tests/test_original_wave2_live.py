"""Original REL-07/09/11 and PLAN-02/03/04/05 against isolated nverify sales Postgres."""
from __future__ import annotations

import os
import threading
import uuid
from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import joinedload, sessionmaker
from sqlalchemy.pool import NullPool

URL = os.environ.get("HARI_OM_SALES_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify sales Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import SalesOrder, SalesOrderDeliverySchedule, SalesOrderLine, SalesOrderReleaseLot, SalesOrderStatus
from src.due_risk import plant_today
from src.pending_workspace import serialize_pending_order
from src.routers.sales_orders import (
    ReleaseLotJobCardSyncPayload,
    SalesOrderCreate,
    SalesOrderLineInput,
    SalesOrderLineReleasePayload,
    approve_sales_order,
    create_sales_order,
    release_sales_order,
    release_sales_order_line,
    sync_release_lot_job_card,
)
from src.schedule_service import commit_entire_po, list_order_schedules, mutate_schedule_row

Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
PLANT = "PLANT-1"


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _user(sub: str, roles=("Admin", "Sales")) -> dict:
    return {"sub": sub, "actual_sub": sub, "roles": list(roles), "token": ""}


def _line(**kwargs) -> SalesOrderLineInput:
    payload = dict(
        approved_spec_id=uuid.uuid4(),
        qty=10,
        due_date=date.today() + timedelta(days=14),
        parchment_required=False,
    )
    payload.update(kwargs)
    return SalesOrderLineInput(**payload)


def _create_approved(db, *, lines, po="PO"):
    created = create_sales_order(
        SalesOrderCreate(
            customer_id=uuid.uuid4(),
            origin="CUSTOMER_PO",
            po_number=f"{po}-{uuid.uuid4().hex[:6]}",
            po_date=date(2026, 9, 1),
            lines=lines,
        ),
        db=db,
        plant_id=PLANT,
        current_user=_user("sales-a"),
    )
    payload = created if isinstance(created, dict) else created
    order_id = payload["id"] if isinstance(payload, dict) else payload.id
    approve_sales_order(order_id, db=db, plant_id=PLANT, current_user=_user("sales-b"))
    return (
        db.query(SalesOrder)
        .options(
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.release_lots),
            joinedload(SalesOrder.lines).joinedload(SalesOrderLine.delivery_schedules),
        )
        .filter(SalesOrder.id == order_id)
        .one()
    )


def test_rel07_lost_production_response_replays_same_lot_without_new_release():
    db = Session()
    try:
        order = _create_approved(db, lines=[_line(qty=10)], po="REL7")
        line = order.lines[0]
        lot_id = uuid.uuid4()
        winder = uuid.uuid4()
        first = release_sales_order_line(
            line.id,
            SalesOrderLineReleasePayload(release_qty=6, winder_machine_id=winder, release_lot_id=lot_id),
            db=db,
            plant_id=PLANT,
            current_user=_user("planner-1", roles=("Planner",)),
        )
        assert first["job_card_id"] is None
        replay = release_sales_order_line(
            line.id,
            SalesOrderLineReleasePayload(release_qty=6, winder_machine_id=winder, release_lot_id=lot_id),
            db=db,
            plant_id=PLANT,
            current_user=_user("planner-1", roles=("Planner",)),
        )
        assert replay["release_lot_id"] == lot_id
        assert float(replay["release_qty"]) == 6
        lots = db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.sales_order_line_id == line.id).all()
        assert len(lots) == 1
        job = uuid.uuid4()
        linked = sync_release_lot_job_card(
            lot_id,
            ReleaseLotJobCardSyncPayload(job_card_id=job),
            db=db,
            plant_id=PLANT,
            current_user=_user("planner-1", roles=("Planner",)),
        )
        assert linked["job_card_id"] == job
        again = sync_release_lot_job_card(
            lot_id,
            ReleaseLotJobCardSyncPayload(job_card_id=job),
            db=db,
            plant_id=PLANT,
            current_user=_user("planner-1", roles=("Planner",)),
        )
        assert again["job_card_id"] == job
        assert db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.sales_order_line_id == line.id).count() == 1
    finally:
        db.close()


def test_rel09_partial_multiline_sync_failure_retries_only_pending_line():
    db = Session()
    try:
        order = _create_approved(
            db,
            lines=[_line(qty=8, line_no=1), _line(qty=8, line_no=2, due_date=date.today() + timedelta(days=15))],
            po="REL9",
        )
        winder = uuid.uuid4()
        first = release_sales_order_line(
            order.lines[0].id,
            SalesOrderLineReleasePayload(release_qty=8, winder_machine_id=winder, release_lot_id=uuid.uuid4()),
            db=db,
            plant_id=PLANT,
            current_user=_user("planner-1", roles=("Planner",)),
        )
        second = release_sales_order_line(
            order.lines[1].id,
            SalesOrderLineReleasePayload(release_qty=8, winder_machine_id=winder, release_lot_id=uuid.uuid4()),
            db=db,
            plant_id=PLANT,
            current_user=_user("planner-1", roles=("Planner",)),
        )
        job_a = uuid.uuid4()
        sync_release_lot_job_card(
            first["release_lot_id"],
            ReleaseLotJobCardSyncPayload(job_card_id=job_a),
            db=db,
            plant_id=PLANT,
            current_user=_user("planner-1", roles=("Planner",)),
        )
        lot_a = db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.id == first["release_lot_id"]).one()
        lot_b = db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.id == second["release_lot_id"]).one()
        assert lot_a.job_card_id == job_a
        assert lot_b.job_card_id is None
        job_b = uuid.uuid4()
        sync_release_lot_job_card(
            second["release_lot_id"],
            ReleaseLotJobCardSyncPayload(job_card_id=job_b),
            db=db,
            plant_id=PLANT,
            current_user=_user("planner-1", roles=("Planner",)),
        )
        db.refresh(lot_a)
        db.refresh(lot_b)
        assert lot_a.job_card_id == job_a
        assert lot_b.job_card_id == job_b
        assert db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.sales_order_id == order.id).count() == 2
    finally:
        db.close()


def test_rel11_status_only_header_release_does_not_invent_release_qty():
    db = Session()
    try:
        order = _create_approved(db, lines=[_line(qty=12)], po="REL11")
        release_sales_order(order.id, db=db, plant_id=PLANT, current_user=_user("planner-1", roles=("Planner",)))
        db.refresh(order)
        assert order.status == SalesOrderStatus.RELEASED
        pending = serialize_pending_order(order, plant_today())
        released = sum(float(line["released_qty"]) for line in pending["lines"])
        assert released == 0
        assert pending["unreleased_qty"] == 12
        assert db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.sales_order_id == order.id).count() == 0
        line = order.lines[0]
        actual = release_sales_order_line(
            line.id,
            SalesOrderLineReleasePayload(release_qty=5, winder_machine_id=uuid.uuid4()),
            db=db,
            plant_id=PLANT,
            current_user=_user("planner-1", roles=("Planner",)),
        )
        assert float(actual["release_qty"]) == 5
        db.refresh(order)
        pending = serialize_pending_order(order, plant_today())
        assert sum(float(line["released_qty"]) for line in pending["lines"]) == 5
        assert pending["unreleased_qty"] == 7
    finally:
        db.close()


def test_plan02_saved_schedule_reloads_dates_qty_and_revision():
    db = Session()
    try:
        order = _create_approved(db, lines=[_line(qty=100, due_date=date(2026, 9, 20))], po="PLAN2")
        commit_entire_po(
            db,
            order=order,
            expected_revision=0,
            actor="planner-a",
            line_splits={
                str(order.lines[0].id): [
                    {"delivery_date": date(2026, 9, 20), "quantity": 40},
                    {"delivery_date": date(2026, 9, 28), "quantity": 60},
                ]
            },
        )
        db.commit()
        order_id = order.id
        source_links = [str(row.id) for row in db.query(SalesOrderDeliverySchedule).filter(SalesOrderDeliverySchedule.sales_order_id == order_id)]
    finally:
        db.close()

    other = Session()
    try:
        reloaded = (
            other.query(SalesOrder)
            .options(joinedload(SalesOrder.lines).joinedload(SalesOrderLine.delivery_schedules))
            .filter(SalesOrder.id == order_id)
            .one()
        )
        listed = list_order_schedules(reloaded)
        assert int(listed["schedule_revision"]) == 1
        assert listed["calendar"] == "customer_delivery"
        dates = sorted(item["delivery_date"] for item in listed["items"])
        assert dates == ["2026-09-20", "2026-09-28"]
        qty = sorted(float(item["quantity"]) for item in listed["items"])
        assert qty == [40.0, 60.0]
        assert {item["id"] for item in listed["items"]} == set(source_links)
    finally:
        other.close()


def test_plan03_two_planners_same_preview_revision_conflict_without_overallocation():
    db = Session()
    try:
        order = _create_approved(db, lines=[_line(qty=100, due_date=date(2026, 9, 20))], po="PLAN3")
        order_id = order.id
        due = order.lines[0].due_date
    finally:
        db.close()

    barrier = threading.Barrier(2)
    results: list[object] = []
    lock = threading.Lock()

    def worker() -> None:
        worker_engine = create_engine(URL, poolclass=NullPool)
        session = sessionmaker(bind=worker_engine, autoflush=False, autocommit=False)()
        try:
            current = session.query(SalesOrder).filter(SalesOrder.id == order_id).one()
            barrier.wait(timeout=10)
            commit_entire_po(session, order=current, expected_revision=0, actor="planner-x", default_date=due)
            session.commit()
            with lock:
                results.append(("ok", 1))
        except HTTPException as exc:
            session.rollback()
            with lock:
                results.append(("err", exc.status_code))
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
    assert len([row for row in results if row[0] == "ok"]) == 1, results
    assert len([row for row in results if row[0] == "err" and row[1] == 409]) == 1, results
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


def test_plan04_locked_or_delivered_history_cannot_move_only_editable_remainder():
    db = Session()
    try:
        order = _create_approved(db, lines=[_line(qty=100, due_date=date(2026, 9, 20))], po="PLAN4")
        line = order.lines[0]
        line.fulfilled_qty = 40
        db.commit()
        db.refresh(order)
        commit_entire_po(
            db,
            order=order,
            expected_revision=0,
            actor="planner-a",
            line_splits={
                str(line.id): [
                    {"delivery_date": date(2026, 9, 18), "quantity": 40},
                    {"delivery_date": date(2026, 9, 28), "quantity": 20},
                ]
            },
        )
        db.commit()
        rows = (
            db.query(SalesOrderDeliverySchedule)
            .filter(SalesOrderDeliverySchedule.sales_order_id == order.id)
            .order_by(SalesOrderDeliverySchedule.delivery_date)
            .all()
        )
        locked, remainder = rows[0], rows[1]
        locked.status = "locked"
        db.commit()
        with pytest.raises(HTTPException) as blocked:
            mutate_schedule_row(
                db,
                order=order,
                schedule_id=locked.id,
                updates={"delivery_date": date(2026, 10, 1)},
                actor="planner-a",
            )
        assert blocked.value.status_code == 409
        db.refresh(locked)
        assert locked.delivery_date == date(2026, 9, 18)
        assert float(locked.quantity) == 40
        moved = mutate_schedule_row(
            db,
            order=order,
            schedule_id=remainder.id,
            updates={"delivery_date": date(2026, 10, 2)},
            actor="planner-a",
        )
        assert str(moved["delivery_date"])[:10] == "2026-10-02"
        db.refresh(locked)
        assert locked.delivery_date == date(2026, 9, 18)
    finally:
        db.close()


def test_plan05_customer_schedule_save_does_not_release_or_fulfill():
    db = Session()
    try:
        order = _create_approved(db, lines=[_line(qty=50, due_date=date(2026, 9, 22))], po="PLAN5")
        commit_entire_po(db, order=order, expected_revision=0, actor="planner-a", default_date=date(2026, 9, 22))
        db.commit()
        db.refresh(order)
        assert order.status == SalesOrderStatus.APPROVED
        assert float(order.lines[0].fulfilled_qty or 0) == 0
        pending = serialize_pending_order(order, plant_today())
        assert sum(float(line["released_qty"]) for line in pending["lines"]) == 0
        assert db.query(SalesOrderReleaseLot).filter(SalesOrderReleaseLot.sales_order_id == order.id).count() == 0
        listed = list_order_schedules(order)
        assert listed["calendar"] == "customer_delivery"
        assert "production" not in listed["calendar"]
    finally:
        db.close()
