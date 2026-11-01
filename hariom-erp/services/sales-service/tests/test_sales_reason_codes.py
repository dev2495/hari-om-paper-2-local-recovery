"""Sales reasons are master codes, checked by the sales service (owner decision 4, 1 Nov 2026)."""
import uuid
from datetime import datetime
from types import SimpleNamespace as NS

import pytest
from fastapi import HTTPException

from src.closure_report import closure_report
from src.reasons import ReasonChoice
from src.routers import sales_orders
from src.routers.sales_orders import (
    SalesOrderClosurePayload,
    SalesOrderHoldPayload,
    SalesOrderResumePayload,
    _closure_reason,
    _hold_history_event,
    append_hold_history,
    hold_sales_order,
    resume_sales_order,
)
from src.models import SalesOrderStatus


class _Db:
    def __init__(self):
        self.commits = 0

    def commit(self):
        self.commits += 1


def _order(**extra):
    lines = extra.pop("lines", [NS(qty=100.0, fulfilled_qty=20.0, hold_qty=0.0)])
    base = dict(id=uuid.uuid4(), order_no="SO/26/10/01", plant_id="PLANT-A", held_at=None, status=SalesOrderStatus.APPROVED,
                hold_prev_status=None, hold_reason=None, hold_reason_code=None, held_by=None, hold_history=None, lines=lines)
    base.update(extra)
    return NS(**base)


@pytest.fixture
def calls(monkeypatch):
    seen = []

    def fake_resolve(**kwargs):
        seen.append(kwargs)
        code = str(kwargs.get("code") or "").upper()
        if not code:
            raise HTTPException(status_code=422, detail="Choose a reason")
        if code == "SO-OFF":
            raise HTTPException(status_code=422, detail="SO-OFF is switched off")
        labels = {"SO-CUST-CANCEL": "Customer cancelled the order", "RS-PAYMENT": "Payment or credit cleared"}
        return ReasonChoice(category=kwargs["category"], code=code, label=labels.get(code, code), note=(kwargs.get("note") or None))

    monkeypatch.setattr(sales_orders, "resolve_reason", fake_resolve)
    monkeypatch.setattr(sales_orders, "_serialize_order", lambda order: order)
    monkeypatch.setattr(sales_orders, "emit_audit_event", lambda **kw: None, raising=False)
    return seen


def test_closure_reason_is_checked_against_the_orders_plant_and_label_comes_from_the_master(monkeypatch, calls):
    order = _order()
    monkeypatch.setattr(sales_orders, "_load_scoped_order", lambda db, oid, plant: order)
    code, label, note = _closure_reason(SalesOrderClosurePayload(reason_code="so-cust-cancel", reason_label="forged label", note="on call"), None, order.id, "PLANT-A", {"token": "t"})
    assert (code, label, note) == ("SO-CUST-CANCEL", "Customer cancelled the order", "on call")
    assert calls[-1]["category"] == "SO_CLOSE" and calls[-1]["plant_id"] == "PLANT-A" and calls[-1]["token"] == "t"


def test_closure_without_code_or_with_inactive_code_is_refused(monkeypatch, calls):
    order = _order()
    monkeypatch.setattr(sales_orders, "_load_scoped_order", lambda db, oid, plant: order)
    for payload in (SalesOrderClosurePayload(note="customer said so"), SalesOrderClosurePayload(reason_code="SO-OFF")):
        with pytest.raises(HTTPException) as caught:
            _closure_reason(payload, None, order.id, "PLANT-A", {})
        assert caught.value.status_code == 422


def test_hold_stores_master_label_and_keeps_history(monkeypatch, calls):
    order = _order()
    monkeypatch.setattr(sales_orders, "_load_scoped_order", lambda db, oid, plant: order)
    db = _Db()
    hold_sales_order(order.id, SalesOrderHoldPayload(reason_code="SO-CUST-CANCEL", reason_note="stopped lifting"), db=db, plant_id="PLANT-A", current_user={"sub": "sales@x"})
    assert order.hold_reason == "Customer cancelled the order — stopped lifting"
    assert order.hold_reason_code == "SO-CUST-CANCEL"
    assert order.hold_history[-1]["action"] == "HOLD" and order.hold_history[-1]["qty"] == 80.0
    assert calls[-1]["category"] == "SO_CLOSE"


def test_resume_asks_a_reason_and_keeps_the_hold_in_history(monkeypatch, calls):
    order = _order(held_at=datetime(2026, 10, 1), hold_prev_status="approved", hold_reason="x", hold_reason_code="SO-CUST-CANCEL",
                   hold_history=[{"action": "HOLD", "reason_code": "SO-CUST-CANCEL", "reason_label": "Customer cancelled the order", "at": "2026-10-01T10:00:00"}])
    monkeypatch.setattr(sales_orders, "_load_scoped_order", lambda db, oid, plant: order)
    with pytest.raises(HTTPException):
        resume_sales_order(order.id, SalesOrderResumePayload(reason="free text only"), db=_Db(), plant_id="PLANT-A", current_user={})
    assert order.held_at is not None, "a refused resume changes nothing"
    resume_sales_order(order.id, SalesOrderResumePayload(reason_code="RS-PAYMENT"), db=_Db(), plant_id="PLANT-A", current_user={"sub": "sales@x"})
    assert calls[-1]["category"] == "ORDER_RESUME"
    assert order.held_at is None and order.hold_reason is None
    assert [entry["action"] for entry in order.hold_history] == ["HOLD", "RESUME"]
    assert order.hold_history[-1]["reason_label"] == "Payment or credit cleared"


def test_hold_history_reads_on_the_timeline():
    order = _order()
    entry = append_hold_history(order, "RESUME", by="sales@x", code="RS-PAYMENT", label="Payment or credit cleared", note="paid on 30 Oct")
    event = _hold_history_event(order, 0, entry)
    assert event["title"] == "Customer hold lifted"
    assert event["message"] == "Payment or credit cleared (RS-PAYMENT) · paid on 30 Oct"


def test_list_filter_and_report_endpoint_are_registered():
    paths = {route.path for route in sales_orders.router.routes}
    assert "/sales-orders/reports/closures-by-reason" in paths or "/reports/closures-by-reason" in paths


def test_closure_report_groups_qty_and_count_by_reason_customer_month():
    cust = uuid.uuid4()
    orders = [
        NS(id=1, order_no="A", po_number="P1", customer_id=cust, closure_kind="CANCELLED", closure_reason_code="SO-PRICE", closure_reason="Price not agreed",
           closure_note=None, closure_at=datetime(2026, 10, 3), closure_by="x", lines=[NS(qty=100, short_closed_qty=0, rate_per_pc=2.0)]),
        NS(id=2, order_no="B", po_number="P2", customer_id=cust, closure_kind="SHORT_CLOSED", closure_reason_code="SO-PRICE", closure_reason="Price not agreed",
           closure_note="n", closure_at=datetime(2026, 10, 9), closure_by="x", lines=[NS(qty=60, short_closed_qty=40, rate_per_pc=None)]),
        NS(id=3, order_no="C", po_number=None, customer_id=uuid.uuid4(), closure_kind="SHORT_CLOSED", closure_reason_code="SO-QTY-REDUCED", closure_reason="Customer reduced",
           closure_note=None, closure_at=datetime(2026, 11, 1), closure_by="x", lines=[NS(qty=10, short_closed_qty=5, rate_per_pc=1.0)]),
        NS(id=4, order_no="D", po_number=None, customer_id=cust, closure_kind=None, closure_reason_code=None, closure_reason=None,
           closure_note=None, closure_at=None, closure_by=None, lines=[NS(qty=10, short_closed_qty=0, rate_per_pc=1.0)]),
    ]
    report = closure_report(orders)
    assert report["totals"] == {"orders": 3, "cancelled": 1, "short_closed": 2, "qty": 145.0, "value": 205.0}
    top = report["by_reason"][0]
    assert (top["reason_code"], top["reason_label"], top["orders"], top["qty"], top["cancelled"], top["short_closed"]) == ("SO-PRICE", "Price not agreed", 2, 140.0, 1, 1)
    assert [row["month"] for row in report["by_month"]] == ["2026-10", "2026-11"]
    assert report["by_reason_customer_month"][0]["reason_label"] == "Price not agreed"


def test_line_short_close_from_a_card_shortage_writes_label_code_and_note():
    """Production checked the SHORT_CLOSE code; the order notes line reads "Label (CODE) — note"."""
    assert sales_orders._short_close_reason_text('SH-MATERIAL', 'Material short', 'kraft late') == 'Material short (SH-MATERIAL) — kraft late'
    assert sales_orders._short_close_reason_text('SH-MATERIAL', 'Material short', None) == 'Material short (SH-MATERIAL)'
    assert sales_orders._short_close_reason_text('SH-MATERIAL', None, None) == 'SH-MATERIAL'  # older caller without a label
    payload = sales_orders.SalesOrderLineShortClosePayload(job_card_id=uuid.uuid4(), produced_qty=90, gap_qty=10, reason_code='SH-MATERIAL',
                                                           reason_label='Material short', reason_note='kraft late')
    assert (payload.reason_label, payload.reason_note) == ('Material short', 'kraft late')


def test_returns_from_production_accept_the_checked_code_and_label():
    from src.routers import release_returns as rr
    body = {'job_card_id': uuid.uuid4(), 'return_key': 'card:WINDER:close:1', 'qty': 5, 'reason': 'Machine breakdown',
            'reason_code': 'SS-MACHINE', 'reason_label': 'Machine breakdown'}
    assert rr.StageReturnPayload(**body).reason_label == 'Machine breakdown'
    force = sales_orders.ReleaseLotReturnPayload(job_card_id=uuid.uuid4(), returned_qty=5, reason='Released twice by mistake',
                                                 reason_code='JC-RELEASED-TWICE', reason_label='Released twice by mistake')
    assert force.reason_code == 'JC-RELEASED-TWICE'
