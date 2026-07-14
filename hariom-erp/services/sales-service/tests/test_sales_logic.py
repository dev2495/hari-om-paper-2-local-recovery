from datetime import date, datetime
from types import SimpleNamespace
import uuid

import pytest
from pydantic import ValidationError

from src.routers.sales_orders import SalesOrderLineInput, _serialize_line, carry_forward_lot_split


def test_carry_forward_split_conserves_released_quantity():
    original, carry = carry_forward_lot_split(1000, 175.25)
    assert original == 824.75
    assert carry == 175.25
    assert original + carry == 1000


def test_sales_line_rejects_nonpositive_qty_and_negative_rate():
    with pytest.raises(ValidationError):
        SalesOrderLineInput(approved_spec_id=uuid.uuid4(), qty=0, rate_per_pc=10, due_date=date(2026, 7, 31))
    with pytest.raises(ValidationError):
        SalesOrderLineInput(approved_spec_id=uuid.uuid4(), qty=10, rate_per_pc=-1, due_date=date(2026, 7, 31))


def test_sales_line_serializer_exposes_dispatch_lineage_and_correct_balances():
    line_id = uuid.uuid4()
    line = SimpleNamespace(
        id=line_id,
        sales_order_id=uuid.uuid4(),
        line_no=1,
        approved_spec_id=uuid.uuid4(),
        product_code="TUBE-01",
        parchment_color=None,
        rate_per_pc=12.5,
        qty=100.0,
        due_date=date(2026, 7, 31),
        fulfilled_qty=35.0,
        release_lots=[
            SimpleNamespace(
                id=uuid.uuid4(),
                sales_order_line_id=line_id,
                released_qty=80.0,
                winder_machine_id=None,
                product_code="TUBE-01",
                status="RELEASED",
                job_card_id=uuid.uuid4(),
                released_by="planner@example.com",
                released_by_identity="Planner",
                created_at=datetime(2026, 7, 1, 10, 0),
            )
        ],
        dispatch_logs=[
            SimpleNamespace(
                id=uuid.uuid4(),
                dispatch_line_ref="DISPATCH-REQUEST:stable-1",
                qty=35.0,
                created_at=datetime(2026, 7, 10, 12, 0),
            )
        ],
    )

    payload = _serialize_line(line)

    assert payload["released_qty"] == 80.0
    assert payload["fulfilled_qty"] == 35.0
    assert payload["remaining_qty"] == 65.0
    assert payload["release_remaining_qty"] == 20.0
    assert payload["dispatch_logs"][0]["dispatch_line_ref"] == "DISPATCH-REQUEST:stable-1"
    assert payload["dispatch_logs"][0]["qty"] == 35.0
