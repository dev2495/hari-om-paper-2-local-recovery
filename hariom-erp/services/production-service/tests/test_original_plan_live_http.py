"""PLAN-07/08 live holiday HTTP and two-then-third oven remainder on nverify."""
from __future__ import annotations

import os
import uuid
from datetime import date, timedelta

import httpx
import pytest

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or "hariom_nverify" not in URL:
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from sqlalchemy.orm import sessionmaker

from src.database import Base, engine
from src.models import JobCard, JobCardStageSegment, PLANT_A_UUID, SalesOrder
from src.routers.planning import (
    CLOSED_DATE_WARNING,
    _capacity_allocation_to_qty,
    _feasibility_warning,
    _fetch_plant_closed_dates,
    _future_stage_slots,
    _lane_existing_segment_load,
)

Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)
AUTH = os.environ.get("HARI_OM_AUTH_URL", "http://127.0.0.1:28001")
MASTER = os.environ.get("HARI_OM_MASTER_URL", "http://127.0.0.1:28002")
PLANT = "00000000-0000-0000-0000-0000000000a1"


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _admin_token() -> str:
    response = httpx.post(
        f"{AUTH}/auth/login",
        data={"username": "admin@hariom.com", "password": "admin123"},
        timeout=10.0,
    )
    if response.status_code != 200:
        pytest.skip(f"Auth login unavailable: {response.status_code}")
    token = (response.json() or {}).get("access_token")
    if not token:
        pytest.skip("Auth login returned no access_token")
    return token


def test_plan07_live_holiday_http_skips_closed_date_and_keeps_horizon_remainder(monkeypatch):
    token = _admin_token()
    monkeypatch.setattr("src.routers.planning.settings.MASTERDATA_SERVICE_URL", MASTER)
    holiday = date.today() + timedelta(days=3)
    created = httpx.post(
        f"{MASTER}/master/holidays/",
        json={
            "holiday_date": holiday.isoformat(),
            "holiday_type": "PUBLIC_HOLIDAY",
            "description": "PLAN-07 nverify closed date",
        },
        headers={"Authorization": f"Bearer {token}", "X-Plant-ID": PLANT},
        timeout=10.0,
    )
    if created.status_code not in {200, 201, 409}:
        pytest.fail(f"Holiday create failed: {created.status_code} {created.text}")
    closed = _fetch_plant_closed_dates(token, PLANT, date.today(), horizon_days=30)
    assert holiday in closed
    slots = _future_stage_slots(date.today(), "SHIFT_A", horizon_days=30, closed_dates=closed)
    days = {day for day, _shift in slots}
    assert holiday not in days
    assert max(days) == date.today() + timedelta(days=29)
    warning = _feasibility_warning(
        plan_date=holiday,
        closed_dates=closed,
        capacity=100.0,
        capacity_unit="METERS_PER_DAY",
        planned_total=10.0,
        stage="WINDER",
    )
    assert warning == CLOSED_DATE_WARNING
    open_day = date.today() + timedelta(days=1)
    if open_day in closed:
        open_day = date.today() + timedelta(days=2)
    overflow = _feasibility_warning(
        plan_date=open_day,
        closed_dates=closed,
        capacity=10.0,
        capacity_unit="METERS_PER_DAY",
        planned_total=40.0,
        stage="WINDER",
    )
    assert overflow
    assert "exceeds" in overflow.lower()
    assert "40.00" in overflow


def test_plan08_live_two_oven_jobs_then_third_cannot_overbook():
    db = Session()
    try:
        suffix = uuid.uuid4().hex[:6]
        machine_id = uuid.uuid4()
        plan_date = date.today() + timedelta(days=4)
        jobs = []
        for idx in range(2):
            order = SalesOrder(
                plant_id=PLANT_A_UUID,
                customer_id=uuid.uuid4(),
                spec_id=uuid.uuid4(),
                order_qty=80,
                due_date=plan_date,
            )
            db.add(order)
            db.flush()
            job = JobCard(
                plant_id=PLANT_A_UUID,
                sales_order_id=order.id,
                spec_id=order.spec_id,
                spec_snapshot={"product_code": f"PLAN08-{suffix}-{idx}"},
                planned_qty=80,
                released_qty=80,
                status="PLANNED",
                current_stage="OVEN",
                product_code=f"PLAN08-{suffix}-{idx}",
            )
            db.add(job)
            db.flush()
            db.add(
                JobCardStageSegment(
                    plant_id=PLANT_A_UUID,
                    job_card_id=job.id,
                    stage_type="OVEN",
                    segment_no=1,
                    machine_id=machine_id,
                    plan_date=plan_date,
                    shift_code="SHIFT_A",
                    planned_qty=80,
                    required_capacity=1.0,
                    status="ASSIGNED",
                )
            )
            jobs.append(job)
        db.commit()
        used = _lane_existing_segment_load(
            db,
            plant_id=PLANT_A_UUID,
            stage="OVEN",
            machine_id=machine_id,
            plan_date=plan_date,
            shift_code="SHIFT_A",
        )
        assert used == 2.0
        available = max(2.0 - used, 0.0)
        third_qty, third_load = _capacity_allocation_to_qty(
            "OVEN",
            "BATCHES_PER_DAY",
            {},
            remaining_qty=40.0,
            available_capacity=available,
        )
        assert third_qty == 0.0
        assert third_load == 0.0
        assert len(jobs) == 2
    finally:
        db.close()
