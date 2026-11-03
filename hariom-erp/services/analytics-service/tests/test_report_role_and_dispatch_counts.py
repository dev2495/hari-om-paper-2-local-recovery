"""Report fixes (3 Nov 2026): Sales pulse reaches the roles that see it in the menu, the Dispatch & SLA
report counts sealed challans in the date range and only cards still to ship, and the dashboard reads the
dispatch event the sales timeline actually sends."""
from datetime import date

import pytest
from fastapi import HTTPException

from src.dependencies import require_capability
from src.routers.dashboard import _dispatch_qty_from_timeline_events
from src.routers.jobs import _system_only
from src.routers.reports import SALES_REPORT_CAPABILITIES, _dispatch_report


def _user(role, permissions):
    return {"roles": [role], "permissions": permissions}


def test_sales_report_reaches_sales_planner_and_plant_head_not_qc_or_store():
    gate = require_capability(*SALES_REPORT_CAPABILITIES)
    for role, permissions in (
        ("Sales", ["so:create", "so:approve", "reports:view"]),
        ("Planner", ["planning:schedule", "so:approve", "analytics:view", "reports:view"]),
        ("PlantManager", ["production:entry", "analytics:view", "reports:view"]),
    ):
        assert gate(_user(role, permissions))["roles"] == [role]
    for role, permissions in (("QC", ["qc:inspect", "reports:view"]), ("Store", ["inventory:inward", "reports:view"])):
        with pytest.raises(HTTPException) as error:
            gate(_user(role, permissions))
        assert error.value.status_code == 403


def test_job_queue_is_owner_admin_only():
    assert _system_only(_user("Admin", []))["roles"] == ["Admin"]
    with pytest.raises(HTTPException) as error:
        _system_only(_user("PlantManager", ["analytics:view", "reports:view"]))
    assert error.value.status_code == 403


def _snapshot():
    return {
        "orders": [],
        "ready_jobs": [
            # Shipped in full in two challans: one inside the window, one before it.
            {"id": "card-1", "dispatch_status": "SEALED", "remaining_qty": 0,
             "shipments": [{"id": "ch-2", "qty": 50, "created_at": "2026-10-20T10:00:00"},
                           {"id": "ch-1", "qty": 50, "created_at": "2026-09-01T10:00:00"}]},
            # Part shipped, still at the gate.
            {"id": "card-2", "dispatch_status": None, "remaining_qty": 40,
             "shipments": [{"id": "ch-3", "qty": 60, "created_at": "2026-10-21T09:00:00"}]},
            # Packed, nothing shipped yet.
            {"id": "card-3", "dispatch_status": "DRAFT", "remaining_qty": 100, "shipments": []},
        ],
    }


def test_dispatch_report_counts_challans_in_range_and_only_cards_left_to_ship():
    summary = _dispatch_report(_snapshot(), date(2026, 10, 1), date(2026, 10, 31), "day")["summary"]
    assert summary["sealed_dispatches"] == 2  # ch-2 and ch-3; ch-1 is before the range
    assert summary["ready_job_count"] == 2  # card-1 is fully shipped
    early = _dispatch_report(_snapshot(), date(2026, 9, 1), date(2026, 9, 30), "day")["summary"]
    assert early["sealed_dispatches"] == 1


def test_dashboard_today_dispatch_reads_the_sales_timeline_event():
    today = "2026-11-03"
    events = [
        {"event_type": "SALES_ORDER_DISPATCH_RECORDED", "created_at": "2026-11-03T08:00:00", "qty": 120.0},
        {"event_type": "SALES_ORDER_DISPATCH_RECORDED", "created_at": "2026-11-02T08:00:00", "qty": 999.0},
        {"event_type": "SO_LINE_DISPATCH_RECORDED", "timestamp": "2026-11-03T09:00:00", "payload": {"qty": 30}},
        {"event_type": "SALES_ORDER_RELEASE_RECORDED", "created_at": "2026-11-03T08:00:00", "qty": 500.0},
    ]
    assert _dispatch_qty_from_timeline_events(events, today) == 150.0
