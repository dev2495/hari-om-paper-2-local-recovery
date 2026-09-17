from datetime import date
from types import SimpleNamespace
import uuid

from src.models import SalesOrderStatus
from src.open_demand import serialize_open_demand_line


def test_open_demand_skips_fully_fulfilled_lines():
    order = SimpleNamespace(
        id=uuid.uuid4(),
        order_no="SO-1",
        plant_id="plant-a",
        customer_id=uuid.uuid4(),
        status=SalesOrderStatus.APPROVED,
        po_number="PO-1",
    )
    line = SimpleNamespace(
        id=uuid.uuid4(),
        line_no=1,
        approved_spec_id=uuid.uuid4(),
        product_code="TUBE",
        parchment_color=None,
        qty=100.0,
        fulfilled_qty=100.0,
        due_date=date(2026, 9, 20),
        release_lots=[],
    )
    assert serialize_open_demand_line(order, line) is None


def test_open_demand_includes_remaining_beyond_a_page_sized_set():
    spec_id = uuid.uuid4()
    order = SimpleNamespace(
        id=uuid.uuid4(),
        order_no="SO-OPEN",
        plant_id="plant-a",
        customer_id=uuid.uuid4(),
        status=SalesOrderStatus.RELEASED,
        po_number="CUST-9",
    )
    rows = []
    for index in range(120):
        payload = serialize_open_demand_line(
            order,
            SimpleNamespace(
                id=uuid.uuid4(),
                line_no=index + 1,
                approved_spec_id=spec_id,
                product_code=f"TUBE-{index}",
                parchment_color=None,
                qty=10.0,
                fulfilled_qty=1.0,
                due_date=date(2026, 9, 20),
                release_lots=[],
            ),
        )
        rows.append(payload)
    assert len(rows) == 120
    assert all(row["remaining_qty"] == 9.0 for row in rows)
    assert rows[0]["source_revision"]["approved_spec_id"] == str(spec_id)
