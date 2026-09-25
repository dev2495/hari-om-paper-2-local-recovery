"""Original REL-04/05/08 replay proofs against isolated production Postgres."""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime
from copy import deepcopy

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import sessionmaker

URL = os.environ.get("HARI_OM_PRODUCTION_DATABASE_URL") or os.environ.get("DATABASE_URL", "")
if os.environ.get("HARI_OM_LIVE_PG") != "1" or not ("hariom_nverify" in URL or ("@127.0.0.1:5432/hariom_" in URL and "_integration_" in URL)):
    pytest.skip("Requires isolated hariom_nverify production Postgres", allow_module_level=True)

os.environ["DATABASE_URL"] = URL

from src.database import Base, engine
from src.models import JobCard, JobCardStage, PLANT_A_UUID, SalesOrder
from src.routers.planning import _create_or_sync_job_card_for_line

Session = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def setup_module() -> None:
    Base.metadata.create_all(engine)


def _seed_job(db, *, status="IN_PROGRESS", stage_status="RUNNING", planned_qty=10.0):
    spec_id = uuid.uuid4()
    winder_id = uuid.uuid4()
    release_lot_id = uuid.uuid4()
    order = SalesOrder(
        plant_id=PLANT_A_UUID,
        customer_id=uuid.uuid4(),
        spec_id=spec_id,
        order_qty=planned_qty,
        due_date=date.today(),
    )
    db.add(order)
    db.flush()
    snapshot = {"frozen": "A", "id_min_mm": 50, "mandrel_id": str(uuid.uuid4())}
    job = JobCard(
        plant_id=PLANT_A_UUID,
        sales_order_id=order.id,
        spec_id=spec_id,
        spec_snapshot=snapshot,
        routing_snapshot={"stages": ["WINDER"], "first_stage": "WINDER"},
        material_plan_snapshot={"items": [{"code": "RM-1", "qty": 3}]},
        planned_qty=planned_qty,
        released_qty=planned_qty,
        status=status,
        current_stage="WINDER" if status != "COMPLETED" else "DONE",
        assigned_winder_machine_id=winder_id,
        release_lot_id=release_lot_id,
        product_code="NV-REPLAY",
    )
    db.add(job)
    db.flush()
    stage = JobCardStage(
        job_card_id=job.id,
        stage_type="WINDER",
        status=stage_status,
        plan_date=date(2026, 9, 10),
        shift_code="A",
        planned_start=datetime(2026, 9, 10, 6, 0),
        quality_checks={"samples": [{"sample_id": "S1"}]},
        actuals_snapshot={"output_qty": 4},
    )
    db.add(stage)
    db.commit()
    db.refresh(job)
    return job, snapshot


def _replay(db, job, *, planned_qty=None, spec_id=None):
    line = {
        "id": str(job.sales_order_line_id or uuid.uuid4()),
        "approved_spec_id": str(spec_id or job.spec_id),
    }
    live_order = {"id": str(job.sales_order_id), "priority": "NORMAL"}
    return _create_or_sync_job_card_for_line(
        db=db,
        plant_uuid=PLANT_A_UUID,
        live_order=live_order,
        line=line,
        release_lot_id=job.release_lot_id,
        winder_machine_id=job.assigned_winder_machine_id,
        planned_qty=float(planned_qty if planned_qty is not None else job.planned_qty),
        priority="NORMAL",
        product_code=job.product_code,
        token="test",
        plant_id=str(PLANT_A_UUID),
        current_user={"sub": "planner-1", "roles": ["Planner"]},
    )


def test_rel04_rel05_same_release_replay_is_noop_after_schedule_and_start():
    db = Session()
    try:
        job, snapshot = _seed_job(db)
        before_status = job.status
        before_stage = job.current_stage
        before_plan = deepcopy(job.spec_snapshot)
        returned, created = _replay(db, job)
        db.commit()
        assert created is False
        assert returned.id == job.id
        db.refresh(job)
        assert job.status == before_status
        assert job.current_stage == before_stage
        assert job.spec_snapshot == before_plan == snapshot
        assert job.planned_qty == 10
        stage = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id).one()
        assert stage.status == "RUNNING"
        assert stage.plan_date == date(2026, 9, 10)
        assert stage.shift_code == "A"
        assert stage.actuals_snapshot == {"output_qty": 4}
    finally:
        db.close()


def test_rel05_completed_replay_does_not_reopen():
    db = Session()
    try:
        job, _ = _seed_job(db, status="COMPLETED", stage_status="COMPLETED")
        returned, created = _replay(db, job)
        db.commit()
        assert created is False
        assert returned.status == "COMPLETED"
        assert returned.current_stage == "DONE"
        stage = db.query(JobCardStage).filter(JobCardStage.job_card_id == job.id).one()
        assert stage.status == "COMPLETED"
    finally:
        db.close()


def test_rel08_changed_quantity_or_spec_conflicts_and_leaves_original():
    db = Session()
    try:
        job, snapshot = _seed_job(db)
        with pytest.raises(HTTPException) as qty:
            _replay(db, job, planned_qty=15)
        assert qty.value.status_code == 409
        assert qty.value.detail["code"] == "release_replay_conflict"
        with pytest.raises(HTTPException) as spec:
            _replay(db, job, spec_id=uuid.uuid4())
        assert spec.value.status_code == 409
        db.refresh(job)
        assert job.planned_qty == 10
        assert job.spec_snapshot == snapshot
        assert db.query(JobCard).filter(JobCard.release_lot_id == job.release_lot_id).count() == 1
    finally:
        db.close()
