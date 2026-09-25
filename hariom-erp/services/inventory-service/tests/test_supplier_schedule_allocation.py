"""Receipt-to-schedule allocation is a commitment map, not a second ledger."""
from __future__ import annotations

import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from src.models import ReceiptScheduleAllocation
from src.services.supplier_schedule import allocate_receipt_to_schedule, serialize_schedule


class _FakeQuery:
    def __init__(self, rows):
        self._rows = list(rows)

    def filter(self, *criteria):
        remaining = self._rows
        for criterion in criteria:
            key = criterion.left.key
            rhs = criterion.right
            value = getattr(rhs, "value", rhs)
            remaining = [row for row in remaining if getattr(row, key, None) == value]
        self._rows = remaining
        return self

    def with_for_update(self):
        return self

    def one(self):
        return self.first()

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return list(self._rows)


class _FakeSession:
    def __init__(self, allocations=None, fail_flush=False):
        self.allocations = list(allocations or [])
        self.fail_flush = fail_flush
        self.added = []

    def query(self, model):
        if model is ReceiptScheduleAllocation:
            return _FakeQuery(self.allocations)
        return _FakeQuery([])

    def add(self, row):
        self.added.append(row)
        self.allocations.append(row)

    def flush(self):
        if self.fail_flush:
            raise IntegrityError("INSERT", {}, Exception("uq_receipt_schedule_alloc_pair"))


def _receipt_line(line_id, po_line_id, qty=100.0):
    return SimpleNamespace(id=line_id, purchase_order_line_id=po_line_id, qty_received=qty, receipt=SimpleNamespace(plant_id="PLANT_A"))


def _schedule(schedule_id, po_line_id, qty=80.0, status="CONFIRMED"):
    return SimpleNamespace(
        id=schedule_id,
        purchase_order_line_id=po_line_id,
        scheduled_qty=qty,
        plant_id="PLANT_A",
        cancelled_qty=0,
        version=1,
        change_history=[],
        confirmation_status=status,
        promised_date=date(2026, 9, 20),
        current_date=date(2026, 9, 22),
        notes=None,
        order_line=SimpleNamespace(
            qty_ordered=100.0,
            qty_received=40.0,
            purchase_order_id=uuid.uuid4(),
            item_id=uuid.uuid4(),
            item=SimpleNamespace(item_code="KRAFT-230"),
            order=SimpleNamespace(po_no="PO-1"),
        ),
    )


def test_partial_receipt_allocates_once_and_leaves_remainder():
    plant_id = "PLANT_A"
    po_line_id = uuid.uuid4()
    receipt_line = _receipt_line(uuid.uuid4(), po_line_id, qty=40.0)
    schedule = _schedule(uuid.uuid4(), po_line_id, qty=80.0)
    db = _FakeSession()

    allocation, replayed = allocate_receipt_to_schedule(
        db, plant_id=plant_id, receipt_line=receipt_line, schedule=schedule, qty=40.0
    )

    assert replayed is False
    assert float(allocation.allocated_qty) == 40.0
    assert str(allocation.receipt_line_id) == str(receipt_line.id)
    payload = serialize_schedule(schedule, db)
    assert payload["scheduled_qty"] == 80.0
    assert payload["allocated_qty"] == 40.0
    assert payload["remaining_qty"] == 40.0
    assert payload["ledger"] is False


def test_receipt_replay_same_qty_is_idempotent():
    po_line_id = uuid.uuid4()
    receipt_id = uuid.uuid4()
    schedule_id = uuid.uuid4()
    existing = SimpleNamespace(
        id=uuid.uuid4(),
        receipt_line_id=receipt_id,
        schedule_id=schedule_id,
        allocated_qty=40.0,
    )
    db = _FakeSession(allocations=[existing])
    allocation, replayed = allocate_receipt_to_schedule(
        db,
        plant_id="PLANT_A",
        receipt_line=_receipt_line(receipt_id, po_line_id, qty=40.0),
        schedule=_schedule(schedule_id, po_line_id),
        qty=40.0,
    )
    assert replayed is True
    assert allocation is existing
    assert db.added == []


def test_receipt_replay_cannot_allocate_twice_with_different_qty():
    po_line_id = uuid.uuid4()
    receipt_id = uuid.uuid4()
    schedule_id = uuid.uuid4()
    existing = SimpleNamespace(
        id=uuid.uuid4(),
        receipt_line_id=receipt_id,
        schedule_id=schedule_id,
        allocated_qty=40.0,
    )
    db = _FakeSession(allocations=[existing])
    with pytest.raises(HTTPException) as exc:
        allocate_receipt_to_schedule(
            db,
            plant_id="PLANT_A",
            receipt_line=_receipt_line(receipt_id, po_line_id, qty=40.0),
            schedule=_schedule(schedule_id, po_line_id),
            qty=20.0,
        )
    assert exc.value.status_code == 409
    assert "cannot allocate twice" in str(exc.value.detail)


def test_unique_constraint_collision_is_replay_safe():
    po_line_id = uuid.uuid4()
    db = _FakeSession(fail_flush=True)
    with pytest.raises(HTTPException) as exc:
        allocate_receipt_to_schedule(
            db,
            plant_id="PLANT_A",
            receipt_line=_receipt_line(uuid.uuid4(), po_line_id, qty=10.0),
            schedule=_schedule(uuid.uuid4(), po_line_id),
            qty=10.0,
        )
    assert exc.value.status_code == 409
    assert "cannot allocate twice" in str(exc.value.detail)


def test_cannot_over_allocate_schedule_or_receipt():
    po_line_id = uuid.uuid4()
    schedule_id = uuid.uuid4()
    prior = SimpleNamespace(
        id=uuid.uuid4(),
        receipt_line_id=uuid.uuid4(),
        schedule_id=schedule_id,
        allocated_qty=70.0,
    )
    db = _FakeSession(allocations=[prior])
    with pytest.raises(HTTPException) as exc:
        allocate_receipt_to_schedule(
            db,
            plant_id="PLANT_A",
            receipt_line=_receipt_line(uuid.uuid4(), po_line_id, qty=50.0),
            schedule=_schedule(schedule_id, po_line_id, qty=80.0),
            qty=20.0,
        )
    assert exc.value.status_code == 400
    assert "scheduled quantity" in str(exc.value.detail).lower()


def test_receipt_schedule_pair_is_unique_and_allows_one_receipt_to_span_dates():
    names = {constraint.name for constraint in ReceiptScheduleAllocation.__table__.constraints}
    assert "uq_receipt_schedule_alloc_pair" in names
