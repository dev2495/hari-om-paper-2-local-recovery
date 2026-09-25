"""Original commercial/release/plan cases against isolated hariom_nverify sales Postgres."""
from __future__ import annotations

import os
import threading
import uuid
from types import SimpleNamespace
from datetime import date, timedelta
from math import inf

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

URL = os.environ.get("HARI_OM_SALES_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify sales Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import SalesOrder, SalesOrderDeliverySchedule, SalesOrderLine, SalesOrderOrigin, SalesOrderStatus
from src.routers.sales_orders import (
    SalesOrderBulkImport,
    SalesOrderCreate,
    SalesOrderLineInput,
    SalesOrderLineReleasePayload,
    SalesOrderUpdate,
    approve_sales_order,
    bulk_import_sales_orders,
    create_sales_order,
    release_sales_order_line,
    update_sales_order,
)
from src.schedule_service import commit_entire_po

Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
PLANT = "PLANT-1"


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _created(payload) -> dict:
    if isinstance(payload, dict):
        return payload
    if hasattr(payload, "model_dump"):
        return payload.model_dump()
    return dict(payload)


def _obj(payload):
    def convert(value):
        if isinstance(value, dict):
            return SimpleNamespace(**{key: convert(item) for key, item in value.items()})
        if isinstance(value, list):
            return [convert(item) for item in value]
        return value
    return convert(_created(payload))


def _user(sub: str, roles=("Admin", "Sales")) -> dict:
    return {"sub": sub, "actual_sub": sub, "roles": list(roles), "token": ""}


def _create(*args, **kwargs):
    return _obj(create_sales_order(*args, **kwargs))


def _update(*args, **kwargs):
    return _obj(update_sales_order(*args, **kwargs))


def _line(**kwargs) -> SalesOrderLineInput:
    payload = dict(
        approved_spec_id=uuid.uuid4(),
        qty=10,
        due_date=date.today() + timedelta(days=14),
        parchment_required=False,
    )
    payload.update(kwargs)
    return SalesOrderLineInput(**payload)


def test_comm02_api_rejects_equal_and_earlier_without_partial_save():
    db = Session()
    try:
        before = db.query(SalesOrder).count()
        with pytest.raises(HTTPException) as equal:
            _create(
                SalesOrderCreate(
                    customer_id=uuid.uuid4(),
                    origin="CUSTOMER_PO",
                    po_number=f"PO-EQ-{uuid.uuid4().hex[:6]}",
                    po_date=date(2026, 9, 24),
                    lines=[_line(due_date=date(2026, 9, 24))],
                ),
                db=db,
                plant_id=PLANT,
                current_user=_user("sales-a"),
            )
        assert equal.value.status_code == 400
        assert "Delivery date must be after" in str(equal.value.detail)
        with pytest.raises(HTTPException) as earlier:
            _create(
                SalesOrderCreate(
                    customer_id=uuid.uuid4(),
                    origin="CUSTOMER_PO",
                    po_number=f"PO-EAR-{uuid.uuid4().hex[:6]}",
                    po_date=date(2026, 9, 24),
                    lines=[_line(due_date=date(2026, 9, 20), line_no=2)],
                ),
                db=db,
                plant_id=PLANT,
                current_user=_user("sales-a"),
            )
        assert "Line 2:" in str(earlier.value.detail)
        later = _create(
            SalesOrderCreate(
                customer_id=uuid.uuid4(),
                origin="CUSTOMER_PO",
                po_number=f"PO-OK-{uuid.uuid4().hex[:6]}",
                po_date=date(2026, 9, 24),
                lines=[_line(due_date=date(2026, 9, 25))],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("sales-a"),
        )
        assert later.po_date == date(2026, 9, 24)
        assert later.lines[0].due_date == date(2026, 9, 25)
        assert db.query(SalesOrder).count() == before + 1
    finally:
        db.close()


def test_comm03_header_date_change_does_not_silently_move_commitments():
    db = Session()
    try:
        created = _create(
            SalesOrderCreate(
                customer_id=uuid.uuid4(),
                origin="CUSTOMER_PO",
                po_number=f"PO-HDR-{uuid.uuid4().hex[:6]}",
                po_date=date(2026, 9, 1),
                lines=[
                    _line(due_date=date(2026, 9, 10), qty=4, line_no=1),
                    _line(due_date=date(2026, 9, 12), qty=6, line_no=2),
                ],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("sales-a"),
        )
        with pytest.raises(HTTPException) as blocked:
            _update(
                created.id,
                SalesOrderUpdate(po_date=date(2026, 9, 11)),
                db=db,
                plant_id=PLANT,
                current_user=_user("sales-a"),
            )
        assert blocked.value.status_code == 400
        assert "Line 1:" in str(blocked.value.detail)
        db.rollback()
        db.expire_all()
        stored = db.query(SalesOrder).filter(SalesOrder.id == created.id).one()
        assert stored.po_date == date(2026, 9, 1)
        dates = sorted(line.due_date for line in stored.lines)
        assert dates == [date(2026, 9, 10), date(2026, 9, 12)]
    finally:
        db.close()


def test_comm04_internal_order_clears_external_po_and_needs_second_approver():
    db = Session()
    try:
        created = _create(
            SalesOrderCreate(
                customer_id=uuid.uuid4(),
                origin="INTERNAL",
                po_number="NA",
                po_date=date(2026, 9, 24),
                internal_order_date=date(2026, 9, 17),
                lines=[_line(due_date=date(2026, 9, 17))],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("sales-a"),
        )
        assert created.origin == SalesOrderOrigin.INTERNAL.value or created.origin == "INTERNAL"
        assert created.po_number is None
        assert created.po_date is None
        assert created.internal_order_date == date(2026, 9, 17)
        assert created.order_no.startswith("SO-")
        with pytest.raises(HTTPException) as same_person:
            approve_sales_order(created.id, db=db, plant_id=PLANT, current_user=_user("sales-a"))
        assert same_person.value.status_code == 403
        approved = approve_sales_order(created.id, db=db, plant_id=PLANT, current_user=_user("sales-b"))
        assert approved["status"] == "approved"
    finally:
        db.close()


def test_comm05_review_origin_cannot_be_approved_and_is_not_rewritten():
    db = Session()
    try:
        created = _create(
            SalesOrderCreate(
                customer_id=uuid.uuid4(),
                origin="REVIEW",
                lines=[_line()],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("sales-a"),
        )
        assert created.origin == "REVIEW"
        assert created.origin_review_required is True
        assert created.po_number is None
        with pytest.raises(HTTPException) as blocked:
            approve_sales_order(created.id, db=db, plant_id=PLANT, current_user=_user("sales-b"))
        assert "review" in str(blocked.value.detail).lower()
        stored = db.query(SalesOrder).filter(SalesOrder.id == created.id).one()
        assert stored.origin == "REVIEW"
        assert stored.po_number is None
    finally:
        db.close()


def test_comm06_07_parchment_boolean_round_trips_and_uncheck_clears_stale():
    db = Session()
    try:
        color_id = uuid.uuid4()
        created = _create(
            SalesOrderCreate(
                customer_id=uuid.uuid4(),
                origin="CUSTOMER_PO",
                po_number=f"PO-PAR-{uuid.uuid4().hex[:6]}",
                po_date=date(2026, 9, 1),
                lines=[_line(parchment_required=True, parchment_color="Natural", parchment_color_id=color_id)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("sales-a"),
        )
        line = created.lines[0]
        assert line.parchment_required is True
        assert line.parchment_color == "Natural"
        assert line.parchment_color_id == color_id
        updated = _update(
            created.id,
            SalesOrderUpdate(
                lines=[
                    SalesOrderLineInput(
                        id=line.id,
                        approved_spec_id=line.approved_spec_id,
                        qty=line.qty,
                        due_date=line.due_date,
                        parchment_required=False,
                        parchment_color="Natural",
                        parchment_color_id=color_id,
                    )
                ]
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("sales-a"),
        )
        cleared = updated.lines[0]
        assert cleared.id == line.id
        assert cleared.parchment_required is False
        assert cleared.parchment_color is None
        assert cleared.parchment_color_id is None
    finally:
        db.close()


def test_comm09_stable_line_ids_on_edit_and_remove():
    db = Session()
    try:
        created = _create(
            SalesOrderCreate(
                customer_id=uuid.uuid4(),
                origin="CUSTOMER_PO",
                po_number=f"PO-LID-{uuid.uuid4().hex[:6]}",
                po_date=date(2026, 9, 1),
                lines=[_line(qty=5, line_no=1), _line(qty=7, line_no=2)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("sales-a"),
        )
        first, second = created.lines[0], created.lines[1]
        updated = _update(
            created.id,
            SalesOrderUpdate(
                lines=[
                    SalesOrderLineInput(
                        id=first.id,
                        approved_spec_id=first.approved_spec_id,
                        qty=8,
                        due_date=first.due_date,
                        parchment_required=False,
                    )
                ]
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("sales-a"),
        )
        assert len(updated.lines) == 1
        assert updated.lines[0].id == first.id
        assert float(updated.lines[0].qty) == 8
        assert all(row.id != second.id for row in updated.lines)
    finally:
        db.close()


def test_comm11_concurrent_order_numbers_are_unique():
    barrier = threading.Barrier(8)
    numbers: list[str] = []
    errors: list[str] = []
    lock = threading.Lock()

    def worker() -> None:
        worker_engine = create_engine(URL, poolclass=NullPool)
        session = sessionmaker(bind=worker_engine, autoflush=False, autocommit=False)()
        try:
            barrier.wait(timeout=15)
            created = _create(
                SalesOrderCreate(
                    customer_id=uuid.uuid4(),
                    origin="INTERNAL",
                    internal_order_date=date.today(),
                    lines=[_line(due_date=date.today())],
                ),
                db=session,
                plant_id=PLANT,
                current_user=_user(f"sales-{uuid.uuid4().hex[:4]}"),
            )
            with lock:
                numbers.append(created.order_no)
        except Exception as exc:
            with lock:
                errors.append(f"{type(exc).__name__}:{exc}")
        finally:
            session.close()

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert not errors, errors
    assert len(numbers) == 8
    assert len(set(numbers)) == 8


def test_comm12_bulk_import_and_old_payload_use_server_date_rule():
    db = Session()
    try:
        with pytest.raises(HTTPException) as blocked:
            bulk_import_sales_orders(
                SalesOrderBulkImport(
                    orders=[
                        SalesOrderCreate(
                            customer_id=uuid.uuid4(),
                            origin="CUSTOMER_PO",
                            po_number=f"PO-IMP-{uuid.uuid4().hex[:6]}",
                            po_date=date(2026, 9, 24),
                            lines=[_line(due_date=date(2026, 9, 24))],
                        )
                    ]
                ),
                db=db,
                plant_id=PLANT,
                current_user=_user("sales-a"),
            )
        assert blocked.value.status_code == 400
        assert "Delivery date must be after" in str(blocked.value.detail)
    finally:
        db.close()


def test_rel03_zero_negative_excess_and_unapproved_release_rejected():
    db = Session()
    try:
        with pytest.raises(ValidationError):
            SalesOrderLineReleasePayload(release_qty=0, winder_machine_id=uuid.uuid4())
        with pytest.raises(ValidationError):
            SalesOrderLineReleasePayload(release_qty=-1, winder_machine_id=uuid.uuid4())
        with pytest.raises(ValidationError):
            SalesOrderLineReleasePayload(release_qty=inf, winder_machine_id=uuid.uuid4())
        created = _create(
            SalesOrderCreate(
                customer_id=uuid.uuid4(),
                origin="CUSTOMER_PO",
                po_number=f"PO-REL-{uuid.uuid4().hex[:6]}",
                po_date=date(2026, 9, 1),
                lines=[_line(qty=10)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("sales-a"),
        )
        with pytest.raises(HTTPException) as unapproved:
            release_sales_order_line(
                created.lines[0].id,
                SalesOrderLineReleasePayload(release_qty=1, winder_machine_id=uuid.uuid4()),
                db=db,
                plant_id=PLANT,
                current_user=_user("sales-a", roles=("Sales",)),
            )
        assert unapproved.value.status_code == 400
        approve_sales_order(created.id, db=db, plant_id=PLANT, current_user=_user("sales-b"))
        with pytest.raises(HTTPException) as excess:
            release_sales_order_line(
                created.lines[0].id,
                SalesOrderLineReleasePayload(release_qty=11, winder_machine_id=uuid.uuid4()),
                db=db,
                plant_id=PLANT,
                current_user=_user("planner-1", roles=("Planner",)),
            )
        assert excess.value.status_code == 400
        ok = release_sales_order_line(
            created.lines[0].id,
            SalesOrderLineReleasePayload(release_qty=4, winder_machine_id=uuid.uuid4()),
            db=db,
            plant_id=PLANT,
            current_user=_user("planner-1", roles=("Planner",)),
        )
        assert float(ok["release_qty"]) == 4
    finally:
        db.close()


def test_rel06_concurrent_releases_stay_bounded():
    db = Session()
    try:
        created = _create(
            SalesOrderCreate(
                customer_id=uuid.uuid4(),
                origin="CUSTOMER_PO",
                po_number=f"PO-CON-{uuid.uuid4().hex[:6]}",
                po_date=date(2026, 9, 1),
                lines=[_line(qty=10)],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("sales-a"),
        )
        approve_sales_order(created.id, db=db, plant_id=PLANT, current_user=_user("sales-b"))
        line_id = created.lines[0].id
    finally:
        db.close()

    barrier = threading.Barrier(2)
    results: list[object] = []
    lock = threading.Lock()

    def worker(qty: float) -> None:
        worker_engine = create_engine(URL, poolclass=NullPool)
        session = sessionmaker(bind=worker_engine, autoflush=False, autocommit=False)()
        try:
            barrier.wait(timeout=10)
            release_sales_order_line(
                line_id,
                SalesOrderLineReleasePayload(release_qty=qty, winder_machine_id=uuid.uuid4(), release_lot_id=uuid.uuid4()),
                db=session,
                plant_id=PLANT,
                current_user=_user(f"planner-{qty}", roles=("Planner",)),
            )
            with lock:
                results.append(("ok", qty))
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

    threads = [threading.Thread(target=worker, args=(7,)), threading.Thread(target=worker, args=(7,))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    ok = [row for row in results if row[0] == "ok"]
    err = [row for row in results if row[0] == "err"]
    assert len(ok) == 1, results
    assert len(err) == 1, results
    check = Session()
    try:
        line = check.query(SalesOrderLine).filter(SalesOrderLine.id == line_id).one()
        released = sum(float(lot.released_qty or 0) for lot in line.release_lots)
        assert released <= 10 + 1e-9
        assert abs(released - 7) < 1e-9 or abs(released - 10) < 1e-9
    finally:
        check.close()


def test_plan01_three_line_multi_date_schedule_accounts_for_every_qty():
    db = Session()
    try:
        created = _create(
            SalesOrderCreate(
                customer_id=uuid.uuid4(),
                origin="CUSTOMER_PO",
                po_number=f"PO-3L-{uuid.uuid4().hex[:6]}",
                po_date=date(2026, 9, 1),
                lines=[
                    _line(qty=100, due_date=date(2026, 9, 20), line_no=1),
                    _line(qty=40, due_date=date(2026, 9, 21), line_no=2),
                    _line(qty=60, due_date=date(2026, 9, 22), line_no=3),
                ],
            ),
            db=db,
            plant_id=PLANT,
            current_user=_user("sales-a"),
        )
        approve_sales_order(created.id, db=db, plant_id=PLANT, current_user=_user("sales-b"))
        order = db.query(SalesOrder).filter(SalesOrder.id == created.id).one()
        splits = {
            str(order.lines[0].id): [
                {"delivery_date": date(2026, 9, 20), "quantity": 40},
                {"delivery_date": date(2026, 9, 25), "quantity": 60},
            ],
            str(order.lines[1].id): [{"delivery_date": date(2026, 9, 21), "quantity": 40}],
            str(order.lines[2].id): [
                {"delivery_date": date(2026, 9, 22), "quantity": 20},
                {"delivery_date": date(2026, 9, 28), "quantity": 40},
            ],
        }
        result = commit_entire_po(db, order=order, expected_revision=0, actor="owner-1", line_splits=splits)
        db.commit()
        rows = db.query(SalesOrderDeliverySchedule).filter(SalesOrderDeliverySchedule.sales_order_id == order.id).all()
        assert len(rows) == 5
        by_line = {}
        for row in rows:
            by_line.setdefault(str(row.sales_order_line_id), 0.0)
            by_line[str(row.sales_order_line_id)] += float(row.quantity)
        assert sorted(by_line.values()) == [40.0, 60.0, 100.0]
        assert abs(sum(by_line.values()) - 200.0) < 1e-9
        assert result["merge_mode"] == "append"
    finally:
        db.close()
