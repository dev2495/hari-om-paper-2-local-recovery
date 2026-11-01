"""Employee performance report on live PostgreSQL (owner decision 7, 1 Nov 2026): batch entries (V2) and the
old one-form stages (V1) by the operator recorded on them, with Masters › Employees departments."""
import os
import uuid
from datetime import date, datetime, timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException

if "hardening_test" not in os.environ.get("DATABASE_URL", ""):
    pytest.skip("Requires isolated hardening_test PostgreSQL database", allow_module_level=True)

from src.database import Base, SessionLocal, engine
from src.entry_models import StageEntry
from src.models import JobCard, JobCardStage, SalesOrder
from src.routers.employee_report import employee_performance

PLANNER = {"roles": ["Planner"], "token": "t", "sub": "planner@example.com"}
DAY = date(2026, 10, 30)


@pytest.fixture()
def db():
    Base.metadata.create_all(engine)
    conn = engine.connect()
    transaction = conn.begin()
    session = SessionLocal(bind=conn, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        conn.close()


def _card(db, plant, model="V2"):
    order = SalesOrder(customer_id=uuid.uuid4(), spec_id=uuid.uuid4(), order_qty=1000, due_date=DAY)
    db.add(order)
    db.flush()
    job = JobCard(plant_id=plant, sales_order_id=order.id, spec_id=order.spec_id, planned_qty=1000, released_qty=1000,
                  status="IN_PROGRESS", current_stage="WINDER", routing_snapshot={"stages": ["WINDER", "OVEN", "PROCESS"]},
                  spec_snapshot={"entry_model": model, "customer_name_snapshot": "Acme Tubes"}, job_card_no=f"JC-{uuid.uuid4().hex[:6]}")
    db.add(job)
    db.flush()
    return job


def _entry(db, job, no, *, operator_id, name, stage="WINDER", kind="PRODUCTION", produced=100, accepted=95, rejected=5,
           day=DAY, shift="SHIFT_A", flags=0, samples=0, details=None):
    db.add(StageEntry(plant_id=job.plant_id, job_card_id=job.id, stage=stage, entry_no=no, status="SUBMITTED", kind=kind,
                      business_date=day, shift_code=shift, operator_id=operator_id, operator_name=name, operator_code="W01",
                      produced=produced, accepted=accepted, rejected=rejected, samples=[{"n": i} for i in range(samples)],
                      details={**(details or {}), **({"qc_flag": {"count": flags}} if flags else {})}, created_by="supervisor"))


def _report(db, plant, employees, **filters):
    scope = {"scope_all": False, "selected_plant_id": str(plant), "allowed_plants": [str(plant)]}
    with patch("src.routers.employee_report._employees", return_value=(employees, True)):
        params = {"date_from": DAY - timedelta(days=1), "date_to": DAY + timedelta(days=1), "shift": None, "stage": None,
                  "department": None, "operator": None, **filters}
        return employee_performance(**params, db=db, plant_scope=scope, user=PLANNER)


def test_report_counts_batch_entries_and_old_forms_by_operator_and_department(db):
    plant = uuid.uuid4()
    ramesh, meena = uuid.uuid4(), uuid.uuid4()
    employees = {
        f"id:{ramesh}": {"id": str(ramesh), "name": "Ramesh Patel", "employee_code": "W01", "department": "WINDER"},
        f"id:{meena}": {"id": str(meena), "name": "Meena Shah", "employee_code": "P07", "department": "PROCESS"},
        "name:MEENA SHAH": {"id": str(meena), "name": "Meena Shah", "employee_code": "P07", "department": "PROCESS"},
    }
    job = _card(db, plant)
    _entry(db, job, 1, operator_id=ramesh, name="Ramesh Patel", details={"start_time": "2026-10-30T08:00", "end_time": "2026-10-30T14:00"})
    _entry(db, job, 2, operator_id=ramesh, name="Ramesh Patel", produced=200, accepted=180, rejected=20, shift="SHIFT_B", flags=2, samples=4)
    _entry(db, job, 3, operator_id=ramesh, name="Ramesh Patel", kind="QC_ONLY", produced=0, accepted=0, rejected=0, flags=1, samples=2)
    _entry(db, job, 4, operator_id=meena, name="Meena Shah", stage="PROCESS", produced=900, accepted=880, rejected=20)
    _entry(db, job, 5, operator_id=meena, name="Meena Shah", stage="PROCESS", day=DAY - timedelta(days=9))  # outside the range
    old = _card(db, plant, model="V1")
    db.add(JobCardStage(job_card_id=old.id, stage_type="PROCESS", status="COMPLETED", output_qty=450, scrap_qty=50,
                        actual_end=datetime(2026, 10, 30, 9, 0), shift_code="SHIFT_A", entry_snapshot={"operator_name": "meena  shah"}))
    other_plant = _card(db, uuid.uuid4())
    _entry(db, other_plant, 1, operator_id=ramesh, name="Ramesh Patel")  # another plant: not counted
    db.flush()

    report = _report(db, plant, employees)
    rows = {(row["operator_name"], row["stage"]): row for row in report["rows"]}
    winder = rows[("Ramesh Patel", "WINDER")]
    assert (winder["runs"], winder["made"], winder["good"], winder["rejected"]) == (2, 300, 275, 25)
    assert (winder["reject_pct"], winder["flagged_qc"], winder["qc_readings"]) == (8.3, 3, 6)
    assert (winder["shifts_worked"], winder["hours"], winder["department"], winder["unit"]) == (2, 6.0, "WINDER", "bamboo")
    process = rows[("Meena Shah", "PROCESS")]
    # The old form's operator name is matched to the master, so both runs are one person.
    assert (process["runs"], process["made"], process["good"], process["rejected"]) == (2, 1400, 1330, 70)
    assert process["sources"] == ["BATCH", "CARD_FORM"] and process["unit"] == "pcs"
    assert report["totals"]["operators"] == 2 and report["totals"]["by_unit"]["pcs"]["reject_pct"] == 5.0
    assert report["departments"] == ["PROCESS", "WINDER"]

    assert [row["operator_name"] for row in _report(db, plant, employees, department="process")["rows"]] == ["Meena Shah"]
    assert {row["stage"] for row in _report(db, plant, employees, stage="WINDER")["rows"]} == {"WINDER"}
    night = _report(db, plant, employees, shift="B")["rows"]
    assert [(row["operator_name"], row["runs"]) for row in night] == [("Ramesh Patel", 1)]

    drill = _report(db, plant, employees, operator=f"id:{meena}")["runs"]
    assert [run["run"] for run in drill] == ["Run #4", "Card form"] or [run["run"] for run in drill] == ["Card form", "Run #4"]
    assert all(run["job_card_no"] for run in drill)


def test_bad_filters_get_plain_messages(db):
    with pytest.raises(HTTPException) as backwards:
        _report(db, uuid.uuid4(), {}, date_from=DAY, date_to=DAY - timedelta(days=2))
    assert backwards.value.status_code == 422 and "after" in backwards.value.detail
    with pytest.raises(HTTPException) as stage:
        _report(db, uuid.uuid4(), {}, stage="PAINT")
    assert stage.value.status_code == 422
