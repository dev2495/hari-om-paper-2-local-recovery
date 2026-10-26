"""Cancel / short-close rules for a sales order (client 2026-10-20)."""
from datetime import date
from types import SimpleNamespace as NS

import pytest

from src.order_closure import (
    closure_options,
    display_status,
    droppable,
    lines_after_drop,
    shrink_colour_splits,
    trim_schedules,
    validate_reason,
)
from src.color_allocation import ColorSplit


def lot(qty, status="released", color=None):
    return NS(released_qty=qty, status=status, parchment_color=color, parchment_color_id=None)


def line(qty, fulfilled=0.0, lots=(), schedules=()):
    return NS(qty=qty, fulfilled_qty=fulfilled, release_lots=list(lots), delivery_schedules=list(schedules), hold_qty=0.0)


def order(status, lines, **extra):
    return NS(status=NS(value=status), lines=lines, held_at=extra.get("held_at"), closure_kind=extra.get("closure_kind"))


def test_cancel_allowed_before_anything_is_released():
    options = closure_options(order("approved", [line(1000)]))
    assert options["cancel"]["allowed"]
    assert not options["short_close"]["allowed"]
    assert "Cancel order" in options["short_close"]["reason"]


def test_draft_can_be_cancelled_but_not_short_closed():
    options = closure_options(order("draft", [line(500)]))
    assert options["cancel"]["allowed"]
    assert "not approved" in options["short_close"]["reason"]


def test_released_order_cannot_be_cancelled_but_can_drop_the_unreleased_balance():
    options = closure_options(order("partially_released", [line(1000, lots=[lot(400)])]))
    assert not options["cancel"]["allowed"]
    assert "released to job cards" in options["cancel"]["reason"]
    assert options["short_close"]["allowed"]
    assert options["drop_qty"] == 600


def test_dispatched_order_points_to_short_close():
    options = closure_options(order("partially_dispatched", [line(1000, fulfilled=300, lots=[lot(300)])]))
    assert "already dispatched" in options["cancel"]["reason"]
    assert options["short_close"]["allowed"] and options["drop_qty"] == 700


def test_cancelled_lots_do_not_count_as_released():
    # A force-closed job card that made nothing gives its whole lot back; the order can be cancelled again.
    options = closure_options(order("approved", [line(1000, lots=[lot(0, "cancelled")])]))
    assert options["cancel"]["allowed"]


def test_fully_released_order_has_nothing_to_drop():
    options = closure_options(order("released", [line(1000, lots=[lot(1000)])]))
    assert not options["short_close"]["allowed"]
    assert "closes by itself" in options["short_close"]["reason"]


def test_finished_and_cancelled_orders_allow_nothing():
    done = closure_options(order("closed", [line(500, fulfilled=500, lots=[lot(500)])]))
    assert not done["cancel"]["allowed"] and not done["short_close"]["allowed"]
    assert "everything was dispatched" in done["cancel"]["reason"]
    gone = order("closed", [line(500)], closure_kind="CANCELLED")
    assert "already cancelled" in closure_options(gone)["cancel"]["reason"]
    assert display_status(gone) == "cancelled"


def test_order_on_customer_hold_can_still_be_cancelled_or_short_closed():
    held = closure_options(order("closed", [line(800)], held_at="2026-10-01"))
    assert held["cancel"]["allowed"] and held["held"]
    held_started = closure_options(order("closed", [line(800, fulfilled=200, lots=[lot(500)])], held_at="2026-10-01"))
    assert held_started["short_close"]["allowed"] and held_started["drop_qty"] == 300


def test_line_floor_is_the_larger_of_released_and_dispatched():
    assert droppable(line(1000, fulfilled=300, lots=[lot(200)])) == 700
    assert droppable(line(1000, fulfilled=300, lots=[lot(600)])) == 400
    assert [drop for _, drop in lines_after_drop([line(100, lots=[lot(100)]), line(50)])] == [50]


def test_reason_code_is_required_and_other_needs_a_note():
    with pytest.raises(ValueError, match="reason code"):
        validate_reason("  ", None)
    with pytest.raises(ValueError, match="note"):
        validate_reason("so-other", "")
    assert validate_reason("so-cust-cancel", " called ") == ("SO-CUST-CANCEL", "called")


def schedule(day, qty, status="committed", allocations=()):
    return NS(id=f"s{day}", delivery_date=date(2026, 11, day), quantity=qty, status=status, allocations=list(allocations))


def test_short_close_trims_the_latest_free_call_offs_first():
    rows = [schedule(1, 300, "delivered"), schedule(10, 300, allocations=["a"]), schedule(20, 300), schedule(25, 300)]
    changed = trim_schedules(line(700, schedules=rows), 700)
    assert [row.id for row in changed] == ["s25", "s20"]
    assert rows[3].status == "cancelled" and rows[3].quantity == 0
    assert rows[2].quantity == 100 and rows[2].status == "committed"
    assert rows[0].quantity == 300 and rows[1].quantity == 300


def test_colour_splits_shrink_to_what_was_released_in_each_colour():
    splits = [ColorSplit(color="Blue", qty=600), ColorSplit(color="Red", qty=400)]
    kept = shrink_colour_splits(line(500), splits, {splits[0].key: 500.0})
    assert [(split.color, split.qty) for split in kept] == [("Blue", 500.0)]
    assert shrink_colour_splits(line(1000), [ColorSplit(color="Blue", qty=600)], {}) is None


def test_customer_hold_and_close_needs_an_order_close_reason_code():
    """Customer hold & close shuts the PO, so it asks for the same reason code (client 2026-10-26)."""
    import uuid
    from fastapi import HTTPException
    from src.order_closure import hold_reason_text
    from src.routers.sales_orders import SalesOrderHoldPayload, hold_sales_order

    # The code is checked before the order is even read.
    with pytest.raises(HTTPException) as missing:
        hold_sales_order(uuid.uuid4(), SalesOrderHoldPayload(reason="Customer not lifting since July"), db=None, plant_id="P", current_user={})
    assert missing.value.status_code == 422 and missing.value.detail == "Choose a reason code."
    with pytest.raises(HTTPException) as other:
        hold_sales_order(uuid.uuid4(), SalesOrderHoldPayload(reason_code="OTHER", note="no"), db=None, plant_id="P", current_user={})
    assert other.value.status_code == 422 and "Other" in other.value.detail
    assert hold_reason_text("Customer not lifting", "CUST_HOLD", "since July") == "Customer not lifting — since July"
    assert hold_reason_text(None, "CUST_HOLD", "") == "CUST_HOLD"
