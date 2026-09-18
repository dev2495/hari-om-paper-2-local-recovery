from datetime import date
from types import SimpleNamespace
import uuid

import pytest

from src.pending_workspace import (
    build_pending_workspace,
    export_pending_csv,
    infer_source,
    order_matches_filters,
    serialize_pending_order,
)
from src.schedule_policy import (
    SchedulePolicyError,
    active_schedule_qty,
    merge_line_schedules,
    propose_entire_po_rows,
    remaining_to_schedule,
    validate_schedule_to_release_allocations,
)


def _line(**kwargs):
    defaults = dict(
        id=uuid.uuid4(),
        line_no=1,
        product_code="TUBE-01",
        approved_spec_id=uuid.uuid4(),
        parchment_color="NATURAL",
        rate_per_pc=10.0,
        qty=1000.0,
        fulfilled_qty=0.0,
        due_date=date(2026, 9, 18),
        release_lots=[],
        delivery_schedules=[],
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _order(**kwargs):
    defaults = dict(
        id=uuid.uuid4(),
        order_no="SO-20260917-0001",
        plant_id="PLANT-1",
        customer_id=uuid.uuid4(),
        po_number="PO-88",
        po_date=date(2026, 9, 1),
        status=SimpleNamespace(value="approved"),
        created_at=None,
        lines=[],
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_infer_source_does_not_guess_internal_from_blank_po():
    assert infer_source(SimpleNamespace(po_number="PO-1", origin="CUSTOMER_PO")) == "customer_po"
    assert infer_source(SimpleNamespace(po_number="  ", origin="INTERNAL")) == "internal"
    assert infer_source(SimpleNamespace(po_number="  ", origin=None)) == "review"
    assert infer_source(SimpleNamespace(po_number=None, origin_review_required=True)) == "review"


def test_remaining_to_schedule_does_not_double_count_unscheduled_fulfillment():
    line = _line(qty=10000, fulfilled_qty=2000)
    assert remaining_to_schedule(line, []) == 8000
    delivered = [SimpleNamespace(quantity=2000, status="delivered")]
    assert remaining_to_schedule(line, delivered) == 8000


def test_over_allocation_is_rejected():
    line = _line(qty=100)
    with pytest.raises(SchedulePolicyError) as exc:
        merge_line_schedules(
            line=line,
            existing=[],
            proposed=[
                {"delivery_date": date(2026, 9, 20), "quantity": 60, "status": "committed"},
                {"delivery_date": date(2026, 9, 21), "quantity": 50, "status": "committed"},
            ],
        )
    assert exc.value.code == "OVER_ALLOCATED"


def test_valid_multi_date_call_off_stays_within_line_qty():
    line = _line(qty=10000)
    merged = merge_line_schedules(
        line=line,
        existing=[],
        proposed=[
            {"delivery_date": date(2026, 9, 20), "quantity": 2000, "status": "committed"},
            {"delivery_date": date(2026, 9, 22), "quantity": 3000, "status": "committed"},
            {"delivery_date": date(2026, 9, 25), "quantity": 5000, "status": "committed"},
        ],
    )
    assert active_schedule_qty(merged) == 10000
    assert len(merged) == 3


def test_locked_or_delivered_rows_cannot_be_replaced():
    locked_id = uuid.uuid4()
    existing = [SimpleNamespace(id=locked_id, sales_order_line_id=uuid.uuid4(), quantity=400, status="locked", delivery_date=date(2026, 9, 19), revision=1, plant_id="PLANT-1")]
    line = _line(qty=1000)
    with pytest.raises(SchedulePolicyError) as exc:
        merge_line_schedules(
            line=line,
            existing=existing,
            proposed=[{"id": str(locked_id), "delivery_date": date(2026, 9, 21), "quantity": 400, "status": "committed"}],
        )
    assert exc.value.code == "IMMUTABLE_SCHEDULE_ROW"


def test_schedule_entire_po_only_allocates_remaining_and_preserves_locked():
    locked = SimpleNamespace(id=uuid.uuid4(), quantity=250, status="locked", delivery_date=date(2026, 9, 18), revision=2, plant_id="PLANT-1", sales_order_line_id=None)
    line_a = _line(qty=1000, delivery_schedules=[locked])
    line_b = _line(qty=500, due_date=date(2026, 9, 21))
    proposed = propose_entire_po_rows([line_a, line_b], default_date=date(2026, 9, 30))
    by_line = {row["line_id"]: row for row in proposed}
    assert by_line[str(line_a.id)]["quantity"] == 750
    assert by_line[str(line_a.id)]["delivery_date"] == date(2026, 9, 30)
    assert by_line[str(line_b.id)]["quantity"] == 500


def test_schedule_entire_po_does_not_touch_release_lot_quantities():
    lot = SimpleNamespace(id=uuid.uuid4(), released_qty=400, status="released", job_card_id=uuid.uuid4(), winder_machine_id=uuid.uuid4())
    line = _line(qty=1000, release_lots=[lot])
    proposed = propose_entire_po_rows([line], default_date=date(2026, 9, 28))
    assert proposed[0]["quantity"] == 1000
    assert lot.released_qty == 400
    assert lot.job_card_id is not None


def test_schedule_entire_po_appends_remaining_without_replacing_committed():
    existing_id = uuid.uuid4()
    existing = [
        SimpleNamespace(
            id=existing_id,
            sales_order_line_id=uuid.uuid4(),
            quantity=40,
            status="committed",
            delivery_date=date(2026, 9, 20),
            revision=1,
            plant_id="PLANT-1",
        )
    ]
    line = _line(qty=100, delivery_schedules=existing)
    remaining = propose_entire_po_rows([line], default_date=date(2026, 9, 30))
    merged = merge_line_schedules(line=line, existing=existing, proposed=remaining, mode="append")
    assert remaining[0]["quantity"] == 60
    assert active_schedule_qty(merged) == 100
    kept = next(row for row in merged if str(row.get("id")) == str(existing_id))
    assert kept["quantity"] == 40
    assert kept["delivery_date"] == date(2026, 9, 20)
    assert any(row.get("quantity") == 60 and not row.get("id") for row in merged)


def test_repeat_entire_po_after_commitment_does_not_duplicate():
    existing = [SimpleNamespace(id=uuid.uuid4(), quantity=100, status="committed", delivery_date=date(2026, 9, 20), revision=1, plant_id="PLANT-1", sales_order_line_id=uuid.uuid4())]
    line = _line(qty=100, delivery_schedules=existing)
    proposed = propose_entire_po_rows([line], default_date=date(2026, 9, 30))
    assert proposed == []
    merged = merge_line_schedules(line=line, existing=existing, proposed=proposed, mode="append")
    assert active_schedule_qty(merged) == 100
    assert len(merged) == 1


def test_remaining_to_schedule_subtracts_unscheduled_fulfillment():
    line = _line(qty=100, fulfilled_qty=40)
    assert remaining_to_schedule(line, []) == 60


def test_new_schedule_row_cannot_be_created_as_delivered():
    line = _line(qty=100)
    with pytest.raises(SchedulePolicyError) as exc:
        merge_line_schedules(
            line=line,
            existing=[],
            proposed=[{"delivery_date": date(2026, 9, 30), "quantity": 40, "status": "delivered"}],
        )
    assert exc.value.code == "INVALID_STATUS"


def test_fulfilled_without_calloff_cannot_overpromise():
    line = _line(qty=100, fulfilled_qty=40)
    with pytest.raises(SchedulePolicyError) as exc:
        merge_line_schedules(
            line=line,
            existing=[],
            proposed=[{"delivery_date": date(2026, 9, 30), "quantity": 100, "status": "committed"}],
        )
    assert exc.value.code == "OVER_ALLOCATED"
    merged = merge_line_schedules(
        line=line,
        existing=[],
        proposed=[{"delivery_date": date(2026, 9, 30), "quantity": 60, "status": "committed"}],
    )
    assert active_schedule_qty(merged) == 60
    schedule_id = str(uuid.uuid4())
    lot_id = str(uuid.uuid4())
    validate_schedule_to_release_allocations(
        [{"delivery_schedule_id": schedule_id, "release_lot_id": lot_id, "quantity": 20}],
        schedule_qty_by_id={schedule_id: 50},
        lot_qty_by_id={lot_id: 40},
    )
    with pytest.raises(SchedulePolicyError):
        validate_schedule_to_release_allocations(
            [{"delivery_schedule_id": schedule_id, "release_lot_id": lot_id, "quantity": 60}],
            schedule_qty_by_id={schedule_id: 50},
            lot_qty_by_id={lot_id: 80},
        )
    with pytest.raises(SchedulePolicyError) as exc:
        validate_schedule_to_release_allocations(
            [
                {"delivery_schedule_id": schedule_id, "release_lot_id": lot_id, "quantity": 10},
                {"delivery_schedule_id": schedule_id, "release_lot_id": lot_id, "quantity": 5},
            ],
            schedule_qty_by_id={schedule_id: 50},
            lot_qty_by_id={lot_id: 40},
        )
    assert exc.value.code == "DUPLICATE_ALLOCATION"


def test_pending_workspace_paginates_after_full_set_summary_and_url_filter():
    today = date(2026, 9, 17)
    orders = []
    for index in range(12):
        line = _line(qty=100 + index, due_date=date(2026, 9, 18) if index % 2 == 0 else date(2026, 10, 1), product_code=f"TUBE-{index:02d}")
        orders.append(_order(order_no=f"SO-{index:04d}", lines=[line], po_number=f"PO-{index}"))
    payload = build_pending_workspace(
        orders,
        filters={"due_risk": "PRIORITY"},
        today=today,
        limit=5,
        offset=0,
        sort="order_no",
        direction="asc",
        plant_scope={"scope_all": False, "selected_plant_id": "PLANT-1"},
    )
    assert payload["summary"]["order_count"] == 6
    assert payload["total_count"] == 6
    assert payload["returned_count"] == 5
    assert payload["has_more"] is True
    assert payload["summary"]["order_count"] > payload["returned_count"]
    export_payload = build_pending_workspace(
        orders,
        filters={"due_risk": "PRIORITY"},
        today=today,
        limit=10_000,
        offset=0,
        sort="order_no",
        direction="asc",
    )
    csv_body = export_pending_csv(export_payload)
    assert csv_body.count("\n") == 7  # header + 6 lines
    assert "TUBE-10" in csv_body
    assert payload["coverage"]["sales"] == "complete"
    assert payload["coverage"]["supplier_calendar"] == "deferred"


def test_pending_product_filter_is_server_side_not_a_loaded_page():
    today = date(2026, 9, 17)
    keep = _order(lines=[_line(product_code="NEEDLE-9")])
    drop = _order(lines=[_line(product_code="OTHER")])
    keep_row = serialize_pending_order(keep, today)
    drop_row = serialize_pending_order(drop, today)
    assert order_matches_filters(keep_row, {"product": "needle"})
    assert not order_matches_filters(drop_row, {"product": "needle"})
